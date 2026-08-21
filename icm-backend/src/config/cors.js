import { isCorsOriginAllowed } from "../services/system/deploymentAccessService.js";

export const corsOptions = {
  origin: (origin, callback) => {
    if (isCorsOriginAllowed(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'Pragma'],
};
