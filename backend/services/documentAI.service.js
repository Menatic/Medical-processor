const { AzureKeyCredential } = require("@azure/core-auth");
const { DocumentAnalysisClient } = require("@azure/ai-form-recognizer");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const pdf = require('pdf-parse');
const fs = require('fs');
const path = require('path');

class DocumentAIService {
  constructor() {
    // Initialize Azure client
    this.documentClient = new DocumentAnalysisClient(
      process.env.AZURE_ENDPOINT,
      new AzureKeyCredential(process.env.AZURE_KEY)
    );
    
    // Initialize Gemini AI with correct model name
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.geminiModel = this.genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  }

  normalizeDoctorId(id) {
    if (!id || id === 'N/A' || id.toLowerCase() === 'n/a') {
      return 'MD-UNKNOWN';
    }
    // Clean and format the ID
    let cleanId = id.toString().trim();
    
    // Look for patterns like "MD567890" or "MD-567890" or just "567890"
    const mdPattern = /(?:MD)?[-]?(\d+)/i;
    const match = cleanId.match(mdPattern);
    
    if (match) {
      return `MD${match[1]}`;
    }
    
    // Extract any numeric sequence as fallback
    const numericPart = cleanId.replace(/[^0-9]/g, '');
    if (numericPart) {
      return `MD${numericPart}`;
    }
    
    return 'MD-UNKNOWN';
  }

  // Add the missing normalizeGeminiData method
  normalizeGeminiData(data) {
    return {
      patient_id: data.patient_id || 'UNKNOWN',
      patient_name: data.patient_name || 'Unknown Patient',
      provider_name: data.provider_name || 'Unknown Provider',
      doctor_id: this.normalizeDoctorId(data.doctor_id),
      diagnosis: data.diagnosis || 'Not specified',
      total_amount: this.parseCurrencyValue(data.total_amount),
      insurance_covered: this.parseCurrencyValue(data.insurance_covered),
      patient_responsibility: this.parseCurrencyValue(data.patient_responsibility),
      service_date: this.parseDateValue(data.service_date),
      medications: []
    };
  }

  async processDocument(filePath) {
    try {
      console.log(`Processing medical document: ${filePath}`);
      const buffer = fs.readFileSync(filePath);
      
      // Step 1: Extract structured data using Azure
      const azureData = await this.processWithAzure(buffer);
      
      // Step 2: Extract additional insights using Gemini
      const geminiData = await this.processWithGemini(buffer);
      
      // Step 3: Merge and enhance results
      const enhancedData = this.mergeResults(azureData, geminiData);
      
      return enhancedData;
    } catch (err) {
      console.error('Document processing error:', err);
      return this.getFallbackData(filePath);
    }
  }

  async processWithAzure(buffer) {
    try {
      // Try different Azure models in sequence
      const models = [
        "prebuilt-document",
        "prebuilt-invoice",
        "prebuilt-layout"
      ];

      let bestResult = null;
      let bestConfidence = 0;

      for (const model of models) {
        try {
          console.log(`Analyzing with Azure model: ${model}`);
          const poller = await this.documentClient.beginAnalyzeDocument(model, buffer);
          const result = await poller.pollUntilDone();
          
          const data = {
            patient_id: '',
            patient_name: '',
            provider_name: '',
            diagnosis: '',
            total_amount: 0,
            insurance_covered: 0,
            patient_responsibility: 0,
            service_date: '',
            medications: []
          };

          // Process document content
          if (result.content) {
            console.log(`Processing content from ${model}`);
            
            // Extract from key-value pairs
            if (result.keyValuePairs) {
              for (const kvp of result.keyValuePairs) {
                if (kvp.key?.content && kvp.value?.content) {
                  const key = kvp.key.content.toLowerCase().trim();
                  const value = kvp.value.content.trim();
                  const confidence = kvp.confidence || 0;

                  if (confidence > 0.5) {
                    this.processKeyValuePair(key, value, data);
                  }
                }
              }
            }

            // Process tables
            if (result.tables) {
              for (const table of result.tables) {
                this.processTable(table, data);
              }
            }

            // Calculate confidence for this result
            const confidence = this.calculateConfidenceScore(data);
            console.log(`Model ${model} confidence: ${confidence}`);

            if (confidence > bestConfidence) {
              bestResult = data;
              bestConfidence = confidence;
            }
          }
        } catch (modelError) {
          console.error(`Error with Azure model ${model}:`, modelError.message);
          continue;
        }
      }

      if (bestResult) {
        console.log(`Using best Azure result with confidence: ${bestConfidence}`);
        return bestResult;
      }

      return null;
    } catch (error) {
      console.error('Azure processing error:', error);
      return null;
    }
  }

  // Update the Gemini prompt to be more specific about doctor ID
  async processWithGemini(buffer) {
    try {
      const { text } = await pdf(buffer);
      
      const prompt = `You are a medical claim form analyzer. Extract the following information from this form in JSON format, with special focus on finding the physician's license or ID number. Look for patterns like "Physician License No:", "License Number:", "Medical License:", "Provider ID:", "MD License:", or any number following a doctor's name:
      {
        "patient_name": "Full Name",
        "patient_id": "Insurance ID or Policy Number",
        "provider_name": "Doctor's Full Name with Title (Dr.)",
        "doctor_id": "Doctor's License Number or Medical ID (e.g., MD567890)",
        "diagnosis": "Diagnosis with ICD Code",
        "total_amount": "Total Amount Billed",
        "insurance_covered": "Amount Paid by Insurance",
        "patient_responsibility": "Amount Due by Patient",
        "service_date": "Date of Service"
      }

      For doctor_id, specifically look for:
      1. "Physician License No:" followed by numbers
      2. "MD" followed by numbers
      3. Any number sequence near "License" and doctor's name
      Document text: ${text}`;

      const result = await this.geminiModel.generateContent(prompt);
      const response = await result.response;
      const analysisText = response.text();
      
      try {
        const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const geminiData = JSON.parse(jsonMatch[0]);
          console.log('Successfully parsed medical claim form');
          return this.normalizeGeminiData(geminiData);
        }
        return null;
      } catch (parseError) {
        console.error('Error parsing Gemini response:', parseError);
        return null;
      }
    } catch (error) {
      console.error('Gemini processing error:', error);
      return null;
    }
  }

  // Enhance doctor ID detection in key-value pairs
  processKeyValuePair(key, value, data) {
    if (key.includes('patient') && key.includes('name')) {
      data.patient_name = value;
    }
    else if (key.includes('patient') && (key.includes('id') || key.includes('mrn'))) {
      data.patient_id = value;
    }
    // Enhanced provider/doctor detection
    else if ((key.includes('physician') || key.includes('doctor') || key.includes('provider') || 
             key.includes('attending') || key.includes('license')) && 
             (key.includes('license') || key.includes('id') || key.includes('no'))) {
      // Enhanced doctor ID extraction
      let doctorId = value.trim();
      
      // Look for common patterns
      const mdPattern = /(?:MD|Medical License|License No\.?|Physician License No\.?)\s*[-:#]?\s*(\d+)/i;
      const numberPattern = /(\d{5,7})/; // Most medical license numbers are 5-7 digits
      
      const mdMatch = doctorId.match(mdPattern);
      const numberMatch = doctorId.match(numberPattern);
      
      if (mdMatch) {
        doctorId = `MD${mdMatch[1]}`;
      } else if (numberMatch) {
        doctorId = `MD${numberMatch[1]}`;
      }
      
      data.doctor_id = this.normalizeDoctorId(doctorId);
    }
    // Enhanced financial data detection
    else if (key.includes('total') || key.includes('amount') || key.includes('billed')) {
      if (key.includes('total') || key.includes('billed')) {
        data.total_amount = this.parseCurrencyValue(value);
      }
    }
    else if ((key.includes('insurance') && key.includes('paid')) || 
             (key.includes('paid') && key.includes('by') && key.includes('insurance'))) {
      data.insurance_covered = this.parseCurrencyValue(value);
    }
    else if ((key.includes('patient') && (key.includes('responsibility') || key.includes('due'))) || 
             (key.includes('amount') && key.includes('due') && key.includes('by') && key.includes('patient'))) {
      data.patient_responsibility = this.parseCurrencyValue(value);
    }
    else if (key.includes('service date') || key.includes('date of service')) {
      const parsedDate = this.parseDateValue(value);
      if (parsedDate) {
        data.service_date = parsedDate;
      }
    }
  }

  processTable(table, data) {
    const headers = table.cells
      .filter(cell => cell.rowIndex === 0)
      .map(cell => cell.content?.toLowerCase() || '');

    // Process medication tables
    if (headers.some(h => h.includes('medication') || h.includes('drug'))) {
      this.processMedicationTable(table, headers, data);
    }
    // Process financial tables
    else if (headers.some(h => h.includes('amount') || h.includes('charge'))) {
      this.processFinancialTable(table, headers, data);
    }
  }

  processMedicationTable(table, headers, data) {
    const nameIdx = headers.findIndex(h => h.includes('medication') || h.includes('drug'));
    const dosageIdx = headers.findIndex(h => h.includes('dosage') || h.includes('strength'));
    const frequencyIdx = headers.findIndex(h => h.includes('frequency') || h.includes('instructions'));

    for (let i = 1; i < table.rowCount; i++) {
      const row = table.cells.filter(cell => cell.rowIndex === i);
      if (row[nameIdx]) {
        data.medications.push({
          name: row[nameIdx].content,
          dosage: dosageIdx !== -1 ? row[dosageIdx]?.content || 'Not specified' : 'Not specified',
          frequency: frequencyIdx !== -1 ? row[frequencyIdx]?.content || 'As directed' : 'As directed'
        });
      }
    }
  }

  processFinancialTable(table, headers, data) {
    const amountIdx = headers.findIndex(h => h.includes('amount') || h.includes('charge'));
    const descIdx = headers.findIndex(h => h.includes('description') || h.includes('type'));

    for (let i = 1; i < table.rowCount; i++) {
      const row = table.cells.filter(cell => cell.rowIndex === i);
      const description = row[descIdx]?.content?.toLowerCase() || '';
      const amount = this.parseCurrencyValue(row[amountIdx]?.content || '0');

      if (description.includes('total')) {
        data.total_amount = amount;
      }
      else if (description.includes('insurance')) {
        data.insurance_covered = amount;
      }
      else if (description.includes('patient')) {
        data.patient_responsibility = amount;
      }
    }
  }

  mergeResults(azureData, geminiData) {
    const merged = { ...this.getFallbackData() };

    if (azureData) {
      Object.assign(merged, azureData);
    }

    if (geminiData) {
      // Enhanced merging logic
      merged.patient_name = merged.patient_name || geminiData.patient_name;
      merged.patient_id = merged.patient_id || geminiData.patient_id;
      merged.provider_name = merged.provider_name || geminiData.provider_name;
      merged.doctor_id = merged.doctor_id || geminiData.doctor_id;
      merged.diagnosis = merged.diagnosis || geminiData.diagnosis;
      
      // More aggressive financial data merging
      if (geminiData.total_amount) {
        merged.total_amount = this.parseCurrencyValue(geminiData.total_amount);
        merged.insurance_covered = this.parseCurrencyValue(geminiData.insurance_covered);
        merged.patient_responsibility = this.parseCurrencyValue(geminiData.patient_responsibility);
      }

      // If we have total and insurance but no patient responsibility, calculate it
      if (merged.total_amount > 0 && merged.insurance_covered >= 0) {
        merged.patient_responsibility = Math.max(0, merged.total_amount - merged.insurance_covered);
      }
    }

    return this.cleanupData(merged);
  }

  cleanupData(data) {
    const today = new Date().toISOString().split('T')[0];
    return {
      ...data,
      patient_id: data.patient_id || 'UNKNOWN',
      patient_name: data.patient_name || 'Unknown Patient',
      provider_name: data.provider_name || 'Unknown Provider',
      diagnosis: data.diagnosis || 'Not specified',
      total_amount: parseFloat((data.total_amount || 0).toFixed(2)),
      insurance_covered: parseFloat((data.insurance_covered || 0).toFixed(2)),
      patient_responsibility: parseFloat((data.patient_responsibility || 0).toFixed(2)),
      service_date: this.parseDateValue(data.service_date) || today,
      medications: Array.isArray(data.medications) ? data.medications : []
    };
  }

  parseCurrencyValue(text) {
    if (!text) return 0;
    // Convert input to string before processing
    const textValue = String(text);
    const numericValue = textValue.replace(/[^0-9.-]+/g, '');
    return parseFloat(numericValue) || 0;
  }

  parseDateValue(dateStr) {
    if (!dateStr) return null;
    
    // Clean up the date string
    const cleanDate = dateStr.toString().trim();
    
    // Try parsing common date formats
    const formats = [
      // MM/DD/YYYY
      {
        regex: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
        parse: (m) => `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
      },
      // YYYY-MM-DD
      {
        regex: /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
        parse: (m) => `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
      },
      // Month DD, YYYY
      {
        regex: /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/,
        parse: (m) => {
          const month = new Date(`${m[1]} 1, 2000`).getMonth() + 1;
          return `${m[3]}-${month.toString().padStart(2, '0')}-${m[2].padStart(2, '0')}`;
        }
      }
    ];

    // Try each format
    for (const format of formats) {
      const match = cleanDate.match(format.regex);
      if (match) {
        try {
          return format.parse(match);
        } catch (e) {
          console.error('Date parsing error:', e);
          continue;
        }
      }
    }

    // If no format matches, try native Date parsing
    const date = new Date(cleanDate);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }

    // Return today's date as fallback
    return new Date().toISOString().split('T')[0];
  }

  getFallbackData(filePath = '') {
    return {
      patient_id: 'UNKNOWN',
      patient_name: 'Unknown Patient',
      provider_name: 'Unknown Provider',
      diagnosis: 'Not specified',
      total_amount: 0.00,
      insurance_covered: 0.00,
      patient_responsibility: 0.00,
      service_date: new Date().toISOString().split('T')[0],
      medications: [],
      document_path: filePath
    };
  }

  calculateConfidenceScore(data) {
    let filledFields = 0;
    let totalFields = 8;

    if (data.patient_name && data.patient_name !== 'Unknown Patient') filledFields++;
    if (data.patient_id && data.patient_id !== 'UNKNOWN') filledFields++;
    if (data.provider_name && data.provider_name !== 'Unknown Provider') filledFields++;
    if (data.diagnosis && data.diagnosis !== 'Not specified') filledFields++;
    if (data.total_amount > 0) filledFields++;
    if (data.insurance_covered > 0) filledFields++;
    if (data.patient_responsibility > 0) filledFields++;
    if (data.service_date && data.service_date !== new Date().toISOString().split('T')[0]) filledFields++;

    // Additional score for medications
    if (data.medications && data.medications.length > 0) {
      filledFields += 0.5;
      totalFields += 0.5;
    }

    return filledFields / totalFields;
  }
}

module.exports = new DocumentAIService();


