import mongoose from 'mongoose';

const applicationRiskProfileSchema = new mongoose.Schema(
  {
    applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', required: true, index: true },
    dataClassification: { type: String, enum: ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'] },
    dataTypes: [{ type: String }],
    regulatoryFrameworks: [{ type: String }],
    inherentRisk: { type: Number },
    controlEffectiveness: { type: Number },
    residualRisk: { type: Number },
    lastRiskAssessmentAt: { type: Date },
    nextReviewDate: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'application_risk_profiles' }
);

export default mongoose.model('ApplicationRiskProfile', applicationRiskProfileSchema);

