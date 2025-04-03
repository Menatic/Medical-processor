const fs = require('fs');
const path = require('path');
const db = require('../models');
const documentAI = require('../services/documentAI.service');

exports.uploadAndProcessClaim = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Get user ID from auth middleware (ensure auth middleware is properly set up)
    const userId = req.user?.id || req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized - User not authenticated' });
    }

    const processedData = await documentAI.processDocument(req.file.path);
    
    const claim = await db.Claim.create({
      patient_id: processedData.patient_id || 'UNKNOWN',
      patient_name: processedData.patient_name,
      doctor_id: processedData.doctor_id || 'UNKNOWN',
      provider_name: processedData.provider_name,
      diagnosis: processedData.diagnosis,
      medications: JSON.stringify(processedData.medications || []),
      document_path: processedData.document_path,
      total_amount: processedData.total_amount || 0,
      insurance_covered: processedData.insurance_covered || 0,
      patient_responsibility: processedData.patient_responsibility || 0,
      service_date: processedData.service_date,
      user_id: userId,  // Use the validated user ID
      status: 'pending'
    });

    res.status(201).json(claim);
  } catch (err) {
    console.error('Claim processing error:', err);
    if (req.file?.path) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: 'Failed to process claim' });
  }
};

exports.getAllClaims = async (req, res) => {
  try {
    const claims = await db.Claim.findAll({
      where: { user_id: req.userId },
      order: [['created_at', 'DESC']]
    });
    
    res.status(200).json({
      success: true,
      data: claims
    });
  } catch (err) {
    console.error('Error fetching claims:', err);
    res.status(500).json({
      success: false,
      message: "Error fetching claims",
      error: err.message
    });
  }
};

exports.getClaimById = async (req, res) => {
  try {
    const claim = await db.Claim.findOne({
      where: {
        id: req.params.id,
        user_id: req.userId
      }
    });
    
    if (!claim) {
      return res.status(404).json({
        success: false,
        message: "Claim not found"
      });
    }
    
    res.status(200).json({
      success: true,
      data: claim
    });
  } catch (err) {
    console.error('Error fetching claim:', err);
    res.status(500).json({
      success: false,
      message: "Error fetching claim",
      error: err.message
    });
  }
};

exports.updateClaimStatus = async (req, res) => {
  try {
    const validStatuses = ['pending', 'approved', 'rejected'];
    if (!validStatuses.includes(req.body.status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status value"
      });
    }

    const [updated] = await db.Claim.update(
      { status: req.body.status },
      { 
        where: { 
          id: req.params.id,
          user_id: req.userId 
        } 
      }
    );

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "Claim not found or not updated"
      });
    }

    return res.status(200).json({
      success: true,
      message: "Claim status updated successfully"
    });

  } catch (err) {
    console.error('Error updating claim:', err);
    return res.status(500).json({
      success: false,
      message: "Failed to update claim status",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

exports.processClaimWithAI = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        message: 'No file uploaded' 
      });
    }

    const userId = req.user?.id || req.userId;
    if (!userId) {
      return res.status(401).json({ 
        success: false,
        message: 'Unauthorized - User not authenticated' 
      });
    }

    console.log(`Processing claim document for user ${userId}: ${req.file.path}`);
    
    const processedData = await documentAI.processDocument(req.file.path);
    
    // Extract only physician/doctor information
    const providerName = processedData.provider_name?.includes('Dr.') ? 
      processedData.provider_name : 
      `Dr. ${processedData.provider_name}`;

    const claim = await db.Claim.create({
      patient_id: processedData.patient_id || 'UNKNOWN',
      patient_name: processedData.patient_name,
      doctor_id: processedData.doctor_id || 'MD-UNKNOWN',
      provider_name: providerName, // Only store doctor's name
      diagnosis: processedData.diagnosis,
      medications: JSON.stringify(processedData.medications || []),
      document_path: req.file.path,
      total_amount: processedData.total_amount || 0,
      insurance_covered: processedData.insurance_covered || 0,
      patient_responsibility: processedData.patient_responsibility || 0,
      service_date: processedData.service_date,
      user_id: userId,
      status: 'pending'
    });

    return res.status(200).json({
      success: true,
      message: 'Claim processed successfully',
      data: {
        id: claim.id,
        patient_name: claim.patient_name,
        provider_name: claim.provider_name, // Include provider name in response
        doctor_id: claim.doctor_id,
        status: claim.status
      }
    });
  } catch (error) {
    console.error('AI Processing error:', error);
    if (req.file?.path) {
      try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
    }
    return res.status(500).json({
      success: false,
      message: 'Failed to process claim: ' + (error.message || 'Unknown error')
    });
  }
};


