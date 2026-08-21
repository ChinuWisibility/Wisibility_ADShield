import mongoose from 'mongoose';

const appCorrelationSchema = new mongoose.Schema({
  tenantId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Tenant', 
    required: true, 
    index: true 
  },
  applicationId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Application', 
    required: true, 
    index: true 
  },
  userField: { type: String, required: true },
  entitlementField: { type: String, required: true },
  matchMethod: { 
    type: String, 
    enum: ['EQUALS', 'CONTAINS', 'IN_ARRAY'], 
    default: 'EQUALS' 
  }
}, { timestamps: true });

// --- DYNAMIC MODEL FACTORY ---
export const getDynamicCorrelationModel = (appName) => {
  const safeName = appName.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  // Naming: App_salesforce_Correlations
  const modelName = `App_${safeName}_Correlations`;
  // Collection: app_salesforce_correlations
  const collectionName = `app_${safeName}_correlations`;

  if (mongoose.models[modelName]) {
    return mongoose.model(modelName);
  }
  
  return mongoose.model(modelName, appCorrelationSchema, collectionName);
};