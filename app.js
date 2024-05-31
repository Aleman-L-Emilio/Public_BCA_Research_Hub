const express = require('express');
const auth0 = require('auth0');
const mysql = require('mysql');
const cors = require('cors');
const bodyParser = require('body-parser');
const cheerio = require('cheerio');
const alert = require('alert');

const path = require('path');
const fs = require('fs');
const multer = require('multer');
const upload = multer({ dest: './temp/' });

const { auth, requiresAuth } = require('express-openid-connect');
const passport = require('passport');
const Auth0Strategy = require('passport-auth0');
const ejs = require("ejs");
const { GoogleAuth } = require('google-auth-library');
const validator = require("validator");
const { sanitize } = require('express-xss-sanitizer');
let sqlSanitizer = require('sql-sanitizer');


// const gapi = require("gapi");
require('dotenv').config();

// require('coffeescript/register');
// const coffeeScript = require('coffee-script');
// const CoffeeScriptModule2 = coffeeScript.loadFile('./node_modules/gapi/lib/gapi.coffee');

const config = {
  authRequired: false,
  auth0Logout: true,
  secret: process.env.SECRET,
  baseURL: process.env.BASEURL,
  clientID: process.env.CLIENTID,
  issuerBaseURL: process.env.ISSUER
}

const pool = mysql.createPool({
  host: process.env.DBHOST,
  user: process.env.DBUSERNAME,
  password: process.env.DBPASSWORD,
  database: process.env.DBDATABASE
});

const userTypeOptions = ['student', 'teacher'];

const app = express();
// const authMiddleware = requiresAuth();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static("public"));
app.use(auth(config));
app.use(passport.initialize());
app.use(sqlSanitizer);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, 'views'));
const { google } = require('googleapis');

// SETTING UP GOOGLE DRIVE FOLDER
const CLIENT_ID = '134797080509-733s923fl3fiq27d9a4o955r953vjesg.apps.googleusercontent.com';
const CLIENT_SECRET = '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';
const REDIRECT_URI = 'https://developers.google.com/oauthplayground';

const REFRESH_TOKEN = '1//04Rz8qzPoQf26CgYIARAAGAQSNwF-L9IrRRVvbzcaYvgZvnXbVA5E0B5o8hjSN2HuqgIYW4CPvE3mmdJ7OvwqvdkuJrFAv2rlzs8';

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI,
);

oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });

const drive = google.drive({
  version: 'v3',
  auth: oauth2Client,
});



function checkIsTeacher(user_email) {
  // testing
  if (user_email == "musmus23@bergen.org") {
    return true;
  }
  
  else if (/[0-9]+/.test(user_email)) {
    return false;
  }
  else {
    return true;
  }
};

app.get('/', (req, res) => {
    res.redirect(req.oidc.isAuthenticated() ? '/data_display' : '/index');
});

app.get('/index', (req, res) => {
  const isAuthenticated = req.oidc.isAuthenticated();
  res.render('index', { isAuthenticated, user: req.oidc.user});
});

app.get('/logout', (req, res) => {
  req.oidc.logout({
    returnTo: 'http://localhost:3000/index'
  });
});

app.get('/callback', (req, res) => {
  res.redirect('/index');
});

app.get('/about', (req, res)=>{
  res.render('about', {isAuthenticated: req.oidc.isAuthenticated(), user: req.oidc.user, isTeacher: checkIsTeacher(req.oidc.user.email)})
});

app.get('/delete_requests', (req, res)=>{
  pool.query('SELECT p.*,u.first_name,u.last_name,u.user_id FROM projects p JOIN students s ON p.student_id=s.student_id JOIN users u ON s.user_id=u.user_id WHERE teacher_email = ? AND production_flag = ?', [req.oidc.user.email, '2'], (error, results) => {
    if (error) {console.log(error);}
    else {
      res.render('delete_requests', {isAuthenticated: req.oidc.isAuthenticated(), user: req.oidc.user, projects : results, isTeacher: checkIsTeacher(req.oidc.user.email)})
    }
  });
});

app.get('/error_redirect', (req, res)=>{
  res.render('error_redirect', {isAuthenticated: req.oidc.isAuthenticated(), user: req.oidc.user, isTeacher: checkIsTeacher(req.oidc.user.email)})
});

app.get('/landing', (req, res) => {
  const isAuthenticated = req.oidc.isAuthenticated();
  if (isAuthenticated) {
    const user = req.oidc.user;

    var userType = '';
    if (/[0-9]+/.test(user.email)) {
      userType = userTypeOptions[0];
    } else {
      userType = userTypeOptions[1];
    }
    
    // console.log('landing isAuthenticated:', isAuthenticated);

    pool.query('SELECT * FROM users WHERE email = ?', [user.email], function(err, results) {
      if (err) throw err;
  
      if (results.length == 0) {
        pool.query('INSERT INTO users (first_name, last_name, email, account_type) VALUES (?, ?, ?, ?)', [user.given_name, user.family_name, user.email, userType], (error, results) => {
          if (error) {
            return res.status(500).send(error);
          }

          const autoIncrementUserID = results.insertId;

          if (userType === 'student') {
            pool.query('INSERT INTO students (user_id) VALUES (?)', [autoIncrementUserID], (error, results, fields) => {
              if (error) {
                console.error(error);
                return;
              }
            })
          } else if (userType === 'teacher') {
            pool.query('INSERT INTO teachers (user_id) VALUES (?)', [autoIncrementUserID], (error, results, fields) => {
              if (error) {
                console.error(error);
                return;
              }
            })
          }
        });
      }
    });

    let user_projects_query =  `
      SELECT p.*, GROUP_CONCAT(t.tag_name SEPARATOR ', ') AS tag_names, u.first_name, u.last_name, u.email
      FROM projects p
      LEFT JOIN project_tag_xref x 
        ON p.project_id = x.project_id
      LEFT JOIN tags t 
        ON x.tag_id = t.tag_id
      JOIN students s ON p.student_id = s.student_id
      JOIN users u ON s.user_id = u.user_id
    `
    user_projects_query+=`WHERE u.email='` + user.email + `'`;
    user_projects_query+=`GROUP BY p.project_id`;
    pool.query(user_projects_query, (error, results) => {
      if (error) {
        return res.send(error.message);
      }
      res.render('landing', { isAuthenticated, projects: results, user: req.oidc.user, isTeacher: checkIsTeacher(req.oidc.user.email) });
    });
  }
  else {
    res.render('landing', { isAuthenticated, isTeacher: checkIsTeacher(req.oidc.user.email) });
  }
});

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");
app.use(express.static(path.join(__dirname, "public")));

app.get('/project_upload', (req, res) => {
  const isAuthenticated = req.oidc.isAuthenticated();
  res.render('project_upload', { isAuthenticated, user: req.oidc.user, isTeacher: checkIsTeacher(req.oidc.user.email) });
});

app.get('/competitions', (req, res) => {
  const isAuthenticated = req.oidc.isAuthenticated();
  res.render('competitions', { isAuthenticated, user: req.oidc.user, isTeacher: checkIsTeacher(req.oidc.user.email) });
});

app.get('/protocols', (req, res) => {
  const isAuthenticated = req.oidc.isAuthenticated();
  res.render('protocols', { isAuthenticated, user: req.oidc.user, isTeacher: checkIsTeacher(req.oidc.user.email) });
});

app.get('/management_console', (req, res) => {
  const isAuthenticated = req.oidc.isAuthenticated();
  if (isAuthenticated) {
    const user = req.oidc.user;

    var userType = '';
    if (/[0-9]+/.test(user.email) & !(user.email === "musmus23@bergen.org")) {
      userType = userTypeOptions[0];
    } else {
      userType = userTypeOptions[1];
    }

    if (userType == "teacher") {
      // let teacher_query = `SELECT u.*
      // FROM projects p
      // JOIN users u
      // ON p.student_id = u.user_id
      // WHERE p.teacher_email = ?`;
      let teacher_query = `SELECT DISTINCT u.*
      FROM projects p
      JOIN students s ON p.student_id = s.student_id
      JOIN users u ON s.user_id = u.user_id
      WHERE p.teacher_email = ?`;
      let students_list = [];
      pool.query(teacher_query, [user.email], (error, results) => {
        if (error) {
          return res.send(error.message);
        }
        res.render(('management_console'), { isAuthenticated, user: user, userType: userType, students: results, isTeacher: checkIsTeacher(req.oidc.user.email) });
      });
    } else {
        res.send("YOU ARE A STUDENT");
      // IN THIS CASE, YOU HAVE A STUDENT, GO TO WORKFLOW MANAGEMENT PAGE
    }
  }
});


app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");
app.use(express.static(path.join(__dirname, "public")));

app.get('/data_display', (req, res) => {
  const isAuthenticated = req.oidc.isAuthenticated();
  // TODO make this able to split/tokenize the input and run the query with all the inputs 
  const search_input = sanitize(req.query.search); // .split();
  // search_input.forEach(()=>{
    
  // });
  let sqlQuery = `
             SELECT p.*, GROUP_CONCAT(t.tag_name SEPARATOR ', ') AS tag_names, u.first_name, u.last_name, u.email AS 'student_email'
             FROM projects p
             LEFT JOIN project_tag_xref x 
              ON p.project_id = x.project_id
             LEFT JOIN tags t 
              ON x.tag_id = t.tag_id
             JOIN students s ON p.student_id = s.student_id
             JOIN users u ON s.user_id = u.user_id
  `
  if (search_input) {
    sqlQuery += ` 
              WHERE p.title LIKE '%${search_input}%'
                OR p.abstract LIKE '%${search_input}%'
                OR p.teacher_email LIKE '%${search_input}%'
                OR p.project_id LIKE '%${search_input}%'
                OR t.tag_name LIKE '%${search_input}%'
                OR u.first_name LIKE '%${search_input}%'
                OR u.last_name LIKE '%${search_input}%'
                OR u.email LIKE '%${search_input}%'`;
  }
  sqlQuery+=` GROUP BY p.project_id`;

  pool.query(sqlQuery, (error, results) => {
    if (error) {
      return res.send(error.message);
    }
    res.render('data_display', { isAuthenticated, projects: results, user: req.oidc.user, isTeacher: checkIsTeacher(req.oidc.user.email) });
  });
});

app.get("/project_expanded", function(req, res) {
  if (! req.query.project_id) {
    res.redirect('/landing');
  }
  else {
    // SECURITY CHECK VARIABLE: STUDENTS CAN ONLY ACCESS PROJECTS THAT ARE THEIR OWN

    // add tags to the query (its ok if its long)
    let project_id = req.query.project_id;
    pool.query('SELECT t.*, p.*, s.student_id, u.email AS student_email FROM tasks t JOIN projects p ON t.project_id = p.project_id JOIN students s ON p.student_id = s.student_id JOIN users u ON s.user_id = u.user_id WHERE t.project_id = ?', [project_id], (error, results)=>{
      if (error) {
        console.log(error);
      }

      // security checkpoint => if req.oidc.user.email != email on project
      // obtain email on project through additional query

      // if (req.oidc.user.email !== results.student_email) {
      //   res.redirect('/error_redirect');
      // }

      if (results.length<1) {
        // run query to get project details for projects with no tasks
        pool.query('SELECT projects.*, students.student_id, users.email AS student_email FROM projects JOIN students ON projects.student_id = students.student_id JOIN users ON students.user_id = users.user_id WHERE projects.project_id = ?', [project_id], (error, details)=>{
          if (error) {console.log(error)}
          if (details.length<1) {
            res.redirect('/error_redirect');
          }
          else {
            // this works, need to comment it out for testing
            // if (req.oidc.user.email !== details[0].student_email) {
            //   // add a check for if is student / if is teacher
            //   res.redirect('/error_redirect');
            // }
            // else {
              res.render('project_expanded', {isAuthenticated: req.oidc.isAuthenticated(), tasks: details, user: req.oidc.user, pid: project_id, isTeacher: checkIsTeacher(req.oidc.user.email)});
            //}
          }
      });

    }
    else {
      // if (req.oidc.user.email !== results[0].student_email) {
      //   res.redirect('/error_redirect');
      // }
      // else {
        res.render('project_expanded', {isAuthenticated: req.oidc.isAuthenticated(), tasks: results, user: req.oidc.user, pid: project_id, isTeacher: checkIsTeacher(req.oidc.user.email) });
      //}
    }
    });
  }


});

app.post("/add-new-task", function(req, res) {
  const {project_id, task_title, task_notes} = req.body;
  console.log("adding new task to proj pid: " + project_id);
  pool.query('INSERT INTO tasks (project_id, task_title, task_notes, task_completion) VALUES (?, ?, ?, ?)', [project_id, task_title, task_notes, 0], (error, results)=>{
    if (error) {
      console.log(error);
    }

    // Pass project id along
    res.redirect(`/project_expanded?project_id=${project_id}`);
  });
});

app.post("/edit-task", function(req, res) {
  const { task_title, task_notes, task_completion, project_id, task_id } = req.body;
  pool.query('UPDATE tasks SET task_title = ?, task_notes = ?, task_completion = ? WHERE task_id = ?', [task_title, task_notes, task_completion, task_id], (error, results, fields) => {
    if (error) {
      console.log(error);
    }
    res.redirect(`/project_expanded?project_id=${project_id}`);
  });
});

app.post("/delete-task", function(req, res) {
  // Retrieve project_id and task_id from the form submission
  var projectId = req.body.project_id;
  var taskId = req.body.task_id;

  // Delete from MySQL
  pool.query('DELETE FROM tasks WHERE task_id = ?', [taskId], (error, results) => {
    if (error) {
      console.log(error);
    }
    console.log('task with task_id=' + taskId + ' deleted from tasks');
    res.redirect(`/project_expanded?project_id=${projectId}`);
  });
});



app.post("/delete-project", function(req, res) {
  // Retrieve project_id and reason from the form submission
  var projectId = req.body.project_id;

  // Delete from MySQL
  pool.query('DELETE FROM projects WHERE project_id = ?', [projectId], (error, results) => {
    if (error) {
      console.log(error);
    }
    console.log('project with project_id=' + projectId + ' deleted from projects');
    res.redirect('/delete_requests');
  });
  deleteFile(projectId);
  // Redirect the user to a new page or display a success message
  // ...
});

app.post("/new-delete-request", function(req, res){
  var {project_id} = req.body;
  pool.query('UPDATE projects SET production_flag = ? WHERE project_id = ?', ['2', project_id], (error, results, fields)=> {
    if (error) {
      console.log(error);
    }
    else {
      res.redirect('/landing');
    }
  });
});

app.post("/send-to-prod", function(req, res){
  var {project_id, user_id} = req.body;
  pool.query('UPDATE projects SET production_flag = ? WHERE project_id = ?', ['1', project_id], (error, results, fields)=> {
    if (error) {
      console.log(error);
    }
    else {
      res.redirect(307, `/accessStudent?user_id=${user_id}`)
    }
  });
});

app.post("/send-to-dev", function(req, res){
  var {project_id, user_id} = req.body;
  pool.query('UPDATE projects SET production_flag = ? WHERE project_id = ?', ['0', project_id], (error, results, fields)=> {
    if (error) {
      console.log(error);
    }
    else {
      res.redirect(307, `/accessStudent?user_id=${user_id}`)
    }
  });
});

app.post("/send-to-del", function(req, res){
  var {project_id} = req.body;
  pool.query('UPDATE projects SET production_flag = ? WHERE project_id = ?', ['2', project_id], (error, results, fields)=> {
    if (error) {
      console.log(error);
    }
    else {
      res.redirect('/delete_requests');
    }
  });
});

app.post("/edit-project", function(req, res) {
  const { title, abstract, project_id } = req.body;
  pool.query('UPDATE projects SET title = ?, abstract = ? WHERE project_id = ?', [title, abstract, project_id], (error, results, fields) => {
    if (error) {
      console.log(error);
    } else {
      // WORK ON EDITING THE PROJECT PDF!
      console.log('project with project_id=' + project_id + ' updated successfully!');
      res.redirect('/landing'); // redirect to the updated project page
    }
  });
});

async function deleteFile(projectId) {
  try {
    // var researchId;
    let query = `SELECT research_paper FROM projects WHERE project_id = ${projectId}`;
    pool.query(query, async (error, results) => {
      var researchId = results[0].research_paper;
      const response = await drive.files.delete({
        fileId: researchId,
      });
      console.log(response.data, response.status);
    });
    
  } catch (error) {
    console.log(error.message);
  }
}

app.post("/delete-project", function(req, res) {
  // retrieve project_id and reason from the form submission
  var projectId = req.body.project_id;
  var reason = req.body.reason;
  console.log("test run:\nproject_id: " + projectId + "\nreason: " + reason);

  // delete from MySQL
  pool.query('DELETE FROM projects WHERE project_id = ?', [projectId], (error, results) => {
    if (error) {
      console.log(error);
    }
    console.log('project with project_id=' + projectId + ' deleted from projects');
    res.redirect('/landing');
  }); 
}); 

// app.post("/edit-project", function(req, res) { 
//   const { title, abstract, project_id } = req.body;
//   pool.query('UPDATE projects SET title = ?, abstract = ? WHERE project_id = ?', [title, abstract, project_id], (error, results, fields) => {
//     if (error) {
//       console.log(error);
//     } else {
//       console.log('project with project_id=' + project_id + ' updated successfully!');
//       res.redirect('/landing'); // redirect to the updated project page
//     }
//   });
// });

app.get("/download-pdf", function(req, res) {
  
});

// app.get('/pdf', (req, res) => {
  // pool.query('SELECT research_paper FROM projects WHERE project_id = 118', (error, results, fields) => {
  //   if (error) throw error;

  //   if (results.length > 0) {
  //     const pdfData = results[0].research_paper;

  //     // Create a Blob object from the PDF data
  //     const pdfBuffer = Buffer.from(pdfData, 'binary');

  //     // Set the Content-Type header to application/pdf
  //     res.setHeader('Content-Type', 'application/pdf');
  //     res.setHeader('Content-Disposition', 'attachment; filename=myfile.pdf');
  //     // Send the Blob object as the response
  //     res.status(200).send(pdfBuffer);
  //   } else {
  //     res.status(404).send('PDF data not found');
  //   }
  // });
// });
const stream = require('stream');
// const multer = require('multer');
// const { google } = require('googleapis');

// const uploadRouter = express.Router();
// const upload = multer();

// const uploadFile = async (fileObject) => {
//   const bufferStream = new stream.PassThrough();
//   bufferStream.end(fileObject.buffer);
//   const { data } = await google.drive({ version: 'v3' }).files.create({
//     media: {
//       mimeType: fileObject.mimeType,
//       body: bufferStream,
//     },
//     requestBody: {
//       name: fileObject.originalname,
//       parents: ['DRIVE_FOLDER_ID'],
//     },
//     fields: 'id,name',
//   });
//   console.log(`Uploaded file ${data.name} ${data.id}`);
// };

// uploadRouter.post('/pdf', upload.any(), async (req, res) => {
//   try {
//     const { body, files } = req;

//     for (let f = 0; f < files.length; f += 1) {
//       await uploadFile(files[f]);
//     }

//     console.log(body);
//     res.status(200).send('Form Submitted');
//   } catch (f) {
//     res.send(f.message);
//   }
// });
// module.exports = uploadRouter;


// const credentials = JSON.parse(fs.readFileSync('credentials.json'));
// const TOKEN_PATH = 'token.json';

app.post('/add_project', upload.single('researchPaper'), async (req, res) => {
  if (req.file != null) {
    // const isAuthenticated = true;
    // const user = req.oidc.user;

    // const CLIENT_ID = '134797080509134797080509-9eq4r7ovtbalkokmt69lnglks5q7kv4c.apps.googleusercontent.com';
    // const API_KEY = 'AIzaSyBfo1f4m_XqkMh_m0C7Tz3TH_rQoDkAaKk';
    // const CLIENT_ID = '134797080509-733s923fl3fiq27d9a4o955r953vjesg.apps.googleusercontent.com';
    // const CLIENT_SECRET = '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';
    // const REDIRECT_URI = 'https://developers.google.com/oauthplayground';

    // const REFRESH_TOKEN = '1//04Rz8qzPoQf26CgYIARAAGAQSNwF-L9IrRRVvbzcaYvgZvnXbVA5E0B5o8hjSN2HuqgIYW4CPvE3mmdJ7OvwqvdkuJrFAv2rlzs8';

    // const oauth2Client = new google.auth.OAuth2(
    //   CLIENT_ID,
    //   CLIENT_SECRET,
    //   REDIRECT_URI,
    // );
    
    // oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });

    // const drive = google.drive({
    //   version: 'v3',
    //   auth: oauth2Client,
    // });
    async function listFolders() {
      try {
        const response = await drive.files.list({
          q: "mimeType='application/vnd.google-apps.folder' and trashed=false",
          fields: "nextPageToken, files(id, name)",
          pageSize: 100,
          supportsAllDrives: true,
        });
    
        const folders = response.data.files;
        console.log(folders);
      } catch (error) {
        console.log(error.message);
      }
    }
    
    // listFolders();


  async function uploadFile() {
    try {
      const filePath = req.file.path;
      const fileMetaData = {
        name: req.body.projectTitle + ".pdf",
        parents: ['1eNqbia3gcUVZMcgh8ogsSIl-c7OL-TN4'],
      };
      const response = await drive.files.create({
        // requestBody: {
        //   name: 'example.pdf', 
        //   mimeType: 'application/pdf',
        // },
        requestBody: fileMetaData,
        media: {
          mimeType: 'application/pdf',
          body: fs.createReadStream(filePath),
        },
      });
      const fileId = response.data.id;
      return fileId;

      // console.log(response.data);
    } catch (error) {
      console.log(error.message);
      res.send("Sorry! We had an error uploading. Please go back and make sure all fields are filled out.")
    }
  }
    var extension = /(\.pdf)$/i;
    if (validator.isEmail(req.body.teacherSelection) & req.file.mimetype == "application/pdf") {  
      var fileId = await uploadFile();
      

  
  // listFolders();



async function uploadFile() {
  try {
    const filePath = req.file.path;
    const fileMetaData = {
      name: req.body.projectTitle + ".pdf",
      parents: ['1eNqbia3gcUVZMcgh8ogsSIl-c7OL-TN4'],
    };
    const response = await drive.files.create({
      // requestBody: {
      //   name: 'example.pdf', 
      //   mimeType: 'application/pdf',
      // },
      requestBody: fileMetaData,
      media: {
        mimeType: 'application/pdf',
        body: fs.createReadStream(filePath),
      },
    });
    const fileId = response.data.id;
    return fileId;

    // console.log(response.data);
  } catch (error) {
    console.log(error.message);
    res.send("Sorry! We had an error uploading. Please go back and make sure all fields are filled out.")
  }
}
  if (validator.isEmail(req.body.teacherSelection) & req.file.mimetype == "application/pdf") {  
    var fileId = await uploadFile();
    

    console.log("FILE ID: " + fileId);

      console.log("FILE ID: " + fileId);

      let studentId=1;
      let email = req.oidc.user.email;
      console.log(email);
      if (req.oidc.isAuthenticated) {
        // query the DB using email, get student_id
        function getStudentId(email) {
          return new Promise((resolve, reject) => {
            pool.query('SELECT students.student_id FROM users JOIN students ON users.user_id = students.user_id WHERE users.email = ?', [email], function (error, results, fields) {
              if (error) reject(error);
              resolve(results[0].student_id);
            });
          });
        }
      }
      getStudentId(email)
        .then((id) => {
          studentId = id;
          var projectTitle = sanitize(req.body.projectTitle);
          var abstract = sanitize(req.body.Abstract);
          var teacherSelection = sanitize(req.body.teacherSelection);
          console.log("inside student id " +  studentId); // This will print the student ID after the query completes
          pool.query('INSERT INTO projects (student_id, title, abstract, research_paper, teacher_id, teacher_email) VALUES (?, ?, ?, ?, ?, ?)', [studentId, projectTitle, abstract, fileId, 1, teacherSelection], (error, results) => {
            if (error) {
              return res.status(500).send(error);
            }
            // pool.query('SELECT LAST_INSERT_ID() as new_primary_key_value', function(err, results) {
              // const max_project = results[0].new_primary_key_value;
              const max_project = results.insertId;
              console.log("MAXIMUM PROJECT: " + max_project);
              if (!(typeof req.body.tagOptions === undefined)) {
                // console.log("TYPE OF: " + typeof(req.body.tagOptions));
                // console.log("TAG OPTIONS: " + req.body.tagOptions);
                if (typeof req.body.tagOptions == 'string') {
                  pool.query('INSERT INTO tags (tag_name) VALUES (?)', [sanitize(req.body.tagOptions)] , (error, results) => {
                    if (error) throw error;
                    // pool.query('SELECT LAST_INSERT_ID() as new_primary_key_value', function(err, results) {
                      // var max_tag = results[0].new_primary_key_value;
                    var max_tag = results.insertId;
                    pool.query('INSERT INTO project_tag_xref (tag_id, project_id) VALUES (?, ?)', [max_tag, max_project], (error, results) => {
                      if (error) throw error;
                    });
                    // });
                  });
                }
                else {
                  for (var i = 0; i < req.body.tagOptions.length; i++) {
                    pool.query('INSERT INTO tags (tag_name) VALUES (?)', [sanitize(req.body.tagOptions[i])] , (error, results) => {
                      if (error) throw error;
                      // pool.query('SELECT LAST_INSERT_ID() as new_primary_key_value', function(err, results) {
                      // var max_tag = results[0].new_primary_key_value;
                      var max_tag = results.insertId;
                      pool.query('INSERT INTO project_tag_xref (tag_id, project_id) VALUES (?, ?)', [max_tag, max_project], (error, results) => {
                        if (error) throw error;
                      });
                      // });
                    });
                  }
                }
              }
              res.redirect('/data_display');
            });  
          });
        // })
        // .catch((error) => {
        //   console.error(error);
        // });
        console.log("outside student id " + studentId);

      }
    }
    else {
      res.send("Need to upload try again");
    }

  // async function deleteFile(projectId) {
  //   try {
  //     // var researchId;
  //     let query = `SELECT research_paper FROM projects WHERE project_id = ${projectId}`;
  //     pool.query(query, async (error, results) => {
  //       var researchId = results[0].research_paper;
  //       const response = await drive.files.delete({
  //         fileId: 'YOUR FILE ID',
  //       });
  //       console.log(response.data, response.status);
  //     });
      
  //   } catch (error) {
  //     console.log(error.message);
  //   }
  // }

  // deleteFile();

  async function generatePublicUrl() {
    try {
      const fileId = 'YOUR FILE ID';
      await drive.permissions.create({
        fileId: fileId,
        requestBody: {
          role: 'reader',
          type: 'anyone',
        },
      });

      /* 
      webViewLink: View the file in browser
      webContentLink: Direct download link 
      */
      
      const result = await drive.files.get({
        fileId: fileId,
        fields: 'webViewLink, webContentLink',
      });
      console.log(result.data);
    } catch (error) {
      console.log(error.message);
    }
  }


  }
  else {
    res.redirect('/data_display');
  }
});

app.get('/get-file-id', (req, res) => {
  const { table, row } = req.query;
  console.log("PROJECT ID: " + row);
  const query = `SELECT research_paper FROM ${table} WHERE project_id = ${row}`;
  pool.query(query, (error, results, fields) => {
    if (error) {
      console.error(error);
      res.status(500).send('Error executing MySQL query');
    } else {
      // console.log(results[0].file_id);
      console.log(results[0].research_paper);
      res.send(results[0].research_paper);
    }
  });
});

app.post('/addBCAExpo', upload.array('bcaExpoForms', 3), async(req, res) => {
  const user = req.oidc.user;

  const CLIENT_ID = '134797080509-733s923fl3fiq27d9a4o955r953vjesg.apps.googleusercontent.com';
  const CLIENT_SECRET = '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';
  const REDIRECT_URI = 'https://developers.google.com/oauthplayground';
  const REFRESH_TOKEN = '1//04Rz8qzPoQf26CgYIARAAGAQSNwF-L9IrRRVvbzcaYvgZvnXbVA5E0B5o8hjSN2HuqgIYW4CPvE3mmdJ7OvwqvdkuJrFAv2rlzs8';
  const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
  const drive = google.drive({
    version: 'v3',
    auth: oauth2Client
  });
  const html = fs.readFileSync('views/competitions.ejs', 'utf8');
  const $ = cheerio.load(html);
  const abstractText = $('h6').text();
  const permSlipText = $('h5').text();
  const resPlanText = $('h4').text();

  const files = req.files
  var fileIdList = [];
  // const filePath = req.files.path;
  
  function uploadFiles() {
    return new Promise((resolve, reject) => {
      if (!files || files.length === 0) {
        console.error('No files uploaded.');
        reject(new Error('No files uploaded.'));
        return;
      }

      const uploadPromises = files.map((file) => {
        return new Promise((resolve, reject) => {
          const fileMetadata = {
            name: user.family_name + "_" + user.given_name + "_" + file.originalname + ".pdf",
            parents: ['1iXpGt_dXyNhpUhrTxy9KxQvR_uHRqCMb']
          };
          const media = {
            mimeType: 'application/pdf',
            body: fs.createReadStream(file.path),
          };
          drive.files.create(
            {
              resource: fileMetadata,
              media: media,
              fields: 'id',
            },
            function (err, res) {
              if (err) {
                console.error('Error uploading file to Google Drive:', err);
                reject(err);
                return;
              }
              const fileId = res.data.id;
              console.log(fileId);
              fileIdList.push(fileId);
              resolve(fileId);

              // console.log(res.data.id);
              // fileIdList.push(res.data.id);
              // // console.log(typeof res.data.id + "res.data.id thingy");
              // return fileIdList;
            }
          );
        });
      });

      Promise.all(uploadPromises)
        .then(() => resolve(fileIdList))
        .catch((error) => reject(error));
    });
  }

  try {
    const extension = /(\.pdf)$/i;
    if (files.every((file) => extension.test(file.originalname))) {
      uploadFiles()
        .then((fileIdList) => {
          console.log("FILE IDs:", fileIdList);
          let studentId=1;
          const email = req.oidc.user.email;
          if (req.oidc.isAuthenticated) {
            // query the DB using email, get student_id
            function getStudentId(email) {
              return new Promise((resolve, reject) => {
                pool.query('SELECT students.student_id FROM users JOIN students ON users.user_id = students.user_id WHERE users.email = ?', [email], function (error, results, fields) {
                  if (error) reject(error);
                  resolve(results[0].student_id);
                });
              });
            }
          }
          
          getStudentId(email)
            .then((id) => {
              studentId = id;
              
              var i;
              //var num = 1;
              for (i = 0; i < fileIdList.length; i++) {
                pool.query('INSERT INTO forms (file_id, student_id, teacher_id, category) VALUES (?, ?, ?, ?)', [fileIdList[i], studentId, 1, 1], (error, results) => {
                  if (error) {
                    return res.status(500).send(error);
                  }
                });
              }
              alert("You have submitted " + fileIdList.length + " file(s) for the BCA Research Expo!");
              
              return res.redirect('/competitions');

            })
            .catch((error) => {
              console.error('Error getting student ID:', error);
              return res.status(500).send('Error getting student ID');
            });
        })
        .catch((error) => {
          console.error('Error uploading files:', error);
          return res.status(500).send('Error uploading files');
        });
      } else {
        console.error('Invalid file extension');
        return res.status(400).send('Invalid file extension');
      }
    } catch (error) {
      console.error('Error:', error);
      return res.status(500).send('Error');
    }
});

app.get('/login', passport.authenticate('local', {
  successRedirect: '/add_user',
  failureRedirect: '/index',
  failureFlash: false
}));

app.post('/add_user', (req, res) => {
  console.log(req.oidc.user);
  pool.query('SELECT * FROM users WHERE email = ?', [req.oidc.user.email], function(err, results) {
    console.log(req, res, err);
    if (err) throw err;

    if (results.length > 0) {
      return res.redirect('/landing');
    }
    pool.query('INSERT INTO users (first_name, last_name, email, account_type) VALUES (?, ?, ?, ?)', [req.oidc.user.given_name, req.oidc.user.family_name, req.oidc.user.email, 'student'], (error, results) => {
      if (error) {
        return res.status(500).send(error);
      }
      res.redirect('/landing');
    });
  });
});

app.listen(3000, () => {
  console.log('Listening on port 3000');
}); 

app.post('/accessStudent', (req, res) => {
  const user_id = req.query.user_id;
  // const student_id = req.query.student_id;
  const isAuthenticated = req.oidc.isAuthenticated(); 

  console_query = `
    SELECT p.*, GROUP_CONCAT(t.tag_name SEPARATOR ', ') AS tag_names, u.first_name, u.last_name, u.email, u.user_id
    FROM projects p
    LEFT JOIN project_tag_xref x 
      ON p.project_id = x.project_id
    LEFT JOIN tags t 
      ON x.tag_id = t.tag_id
    JOIN students s ON p.student_id = s.student_id
    JOIN users u ON s.user_id = u.user_id
    WHERE u.user_id = '` + user_id + `'
    AND p.teacher_email = '`+ req.oidc.user.email +`'
    GROUP BY p.project_id`;
  pool.query('SELECT student_id FROM students WHERE user_id = ?', [user_id], function(err, student) {
    if (err) throw err;
    // console.log("USER_ID:" + user_id);
    const student_id = student[0].student_id;
    console.log("STUDENT_ID:" + student[0].student_id);
    pool.query(console_query, function(err, results) {
      if (err) throw err;
      res.render('management_student', { isAuthenticated, projects: results, reqUser : req.oidc.user, user: student, isTeacher: checkIsTeacher(req.oidc.user.email) });
    });  
  });
});

// document.querySelectorAll('.accessStudent').forEach((student) => {
//   student.addEventListener('click', () => {
//     console.log('Button clicked');
//     const isAuthenticated = req.oidc.isAuthenticated(); 
//     const user_id = student.id;
    
//   });
// });