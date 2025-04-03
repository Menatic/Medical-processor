// config/auth.config.js
module.exports = {
  secret: process.env.JWT_SECRET || 'your_very_secure_jwt_secret_32_chars_min',
  jwtExpiration: 36000, 
  jwtRefreshExpiration: 288000 
};