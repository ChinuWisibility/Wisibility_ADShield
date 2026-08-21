import mongoose from "mongoose";

const distributedLockSchema = new mongoose.Schema(
  {
    _id: { type: String },
    lockedBy: { type: String, required: true },
    lockedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: false, collection: "distributed_locks" },
);

export default mongoose.model("DistributedLock", distributedLockSchema);
