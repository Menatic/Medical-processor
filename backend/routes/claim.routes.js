const express = require("express");
const router = express.Router();
const authJwt = require("../middlewares/authJwt");
const upload = require("../middlewares/upload");
const claimController = require("../controllers/claim.controller");

// Standard claim routes
router.get("/", authJwt.verifyToken, claimController.getAllClaims);
router.post(
  "/",
  authJwt.verifyToken,
  upload.single("document"),
  claimController.uploadAndProcessClaim
);
router.get("/:id", authJwt.verifyToken, claimController.getClaimById);
router.patch(
  "/:id/status",
  authJwt.verifyToken,
  claimController.updateClaimStatus
);

// Add the upload endpoint
router.post(
  "/upload",
  authJwt.verifyToken,
  upload.single("document"),
  claimController.processClaimWithAI
);

module.exports = router;
