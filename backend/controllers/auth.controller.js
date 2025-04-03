const db = require("../models");
const jwt = require("jsonwebtoken");
const config = require("../config/auth.config");
const { Op } = require('sequelize');
const bcrypt = require('bcrypt');

exports.signup = async (req, res) => {
  try {
    // Validate request
    if (!req.body.username || !req.body.email || !req.body.password) {
      return res.status(400).json({ message: "All fields are required!" });
    }

    // Validate password length
    if (req.body.password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    // Check if user exists
    const existingUser = await db.User.unscoped().findOne({
      where: {
        [Op.or]: [
          { username: req.body.username },
          { email: req.body.email }
        ]
      }
    });

    if (existingUser) {
      return res.status(400).json({ message: "Username or email already exists" });
    }

    // Create user
    const user = await db.User.create({
      username: req.body.username,
      email: req.body.email,
      password: req.body.password
    });

    // Generate token
    const token = jwt.sign(
      { id: user.id },
      config.secret,
      { expiresIn: config.jwtExpiration }
    );

    res.status(201).json({
      message: "User registered successfully!",
      user: user.safeUserObject(),
      accessToken: token
    });

  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({
      message: "Registration failed. Please try again.",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

exports.signin = async (req, res) => {
  try {
    const { username, password } = req.body;

    // Validate input
    if (!username || !password) {
      return res.status(400).json({ 
        success: false,
        message: "Username and password are required" 
      });
    }

    // Find user with password
    const user = await db.User.scope('withPassword').findOne({
      where: { username }
    });

    if (!user) {
      return res.status(401).json({ 
        success: false,
        message: "Invalid credentials" 
      });
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ 
        success: false,
        message: "Invalid credentials" 
      });
    }

    // Generate token
    const token = jwt.sign(
      { id: user.id },
      config.secret,
      { expiresIn: config.jwtExpiration }
    );

    // Return user data without password
    const userData = user.get({ plain: true });
    delete userData.password;

    res.status(200).json({
      success: true,
      user: userData,
      accessToken: token
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ 
      success: false,
      message: "Internal server error" 
    });
  }
};

exports.verifyToken = (req, res) => {
  const token = req.headers['x-access-token'] || req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(403).json({ message: "No token provided!" });
  }

  jwt.verify(token, config.secret, (err, decoded) => {
    if (err) {
      return res.status(401).json({ message: "Unauthorized!" });
    }
    
    // Return basic user info
    res.status(200).json({
      user: {
        id: decoded.id,
        username: decoded.username,
        email: decoded.email
      }
    });
  });
};
