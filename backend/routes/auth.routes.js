const express = require("express");
const router = express.Router();
const authController = require("../controllers/auth.controller");

router.post('/login', authController.signin); // Change from /signin to /login
router.post('/register', authController.signup); // Change from /signup to /register
router.get('/me', authController.verifyToken); // Add this line


module.exports = router;