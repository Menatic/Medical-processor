const jwt = require("jsonwebtoken");
const config = require("../config/auth.config");

const verifyToken = (req, res, next) => {
  const token = req.headers["x-access-token"] || req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(403).json({ message: "No token provided!" });
  }

  jwt.verify(token, config.secret, (err, decoded) => {
    if (err) {
      return res.status(401).json({ message: "Unauthorized!" });
    }
    req.userId = decoded.id;
    next();
  });
};

const authJwt = {
  verifyToken
};

exports.verifyToken = (req, res, next) => {
    const token = req.headers['x-access-token'];
    
    if (!token) {
      return res.status(403).json({ message: "No token provided!" });
    }
  
    jwt.verify(token, config.secret, (err, decoded) => {
      if (err) {
        return res.status(401).json({ message: "Unauthorized!" });
      }
      req.userId = decoded.id;
      next();

    });
};

module.exports = authJwt;