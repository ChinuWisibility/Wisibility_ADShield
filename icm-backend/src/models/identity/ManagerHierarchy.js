import mongoose from 'mongoose';

const managerHierarchySchema = new mongoose.Schema(
  {
    identityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Identity', index: true },
    managerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Identity', index: true },
    grandManagerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Identity' },
    managerChain: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Identity' }],
    depth: { type: Number },
    isCircular: { type: Boolean, default: false },
    lastResolvedAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'manager_hierarchy' }
);

export default mongoose.model('ManagerHierarchy', managerHierarchySchema);

