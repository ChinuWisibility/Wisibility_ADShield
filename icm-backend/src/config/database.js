import mongoose from 'mongoose';
import env from './env.js';

let isConnected = false;

/**
 * mongodb+srv:// enables TLS by default; plain mongodb:// needs an explicit
 * tls/ssl param. Local dev (127.0.0.1/localhost) is exempt — a non-TLS
 * connection to a remote host is not, since it would send credentials and
 * data in cleartext over the network.
 */
function assertMongoUriIsSecure(uri) {
  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    return; // Unparseable — let mongoose's own connect() surface the real error.
  }
  const isLocal = ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname);
  if (isLocal) return;
  if (parsed.protocol === 'mongodb+srv:') return;
  const params = parsed.searchParams;
  const tlsEnabled =
    ['true', '1'].includes((params.get('tls') || '').toLowerCase()) ||
    ['true', '1'].includes((params.get('ssl') || '').toLowerCase());
  if (!tlsEnabled) {
    throw new Error(
      `MONGODB_URI points at a non-local host (${parsed.hostname}) without TLS enabled ` +
        '(no ?tls=true/?ssl=true and not a mongodb+srv:// URI). Refusing to connect with ' +
        'credentials and data in cleartext — add ?tls=true to the connection string.',
    );
  }
}

export async function connectDB() {
  if (isConnected) return;

  try {
    assertMongoUriIsSecure(env.mongodb.uri);
    const conn = await mongoose.connect(env.mongodb.uri, {
      dbName: env.mongodb.dbName,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 500000,
      socketTimeoutMS: 45000,
    });

    isConnected = true;
    console.log(`MongoDB connected: ${conn.connection.host}/${env.mongodb.dbName}`);

    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err);
      isConnected = false;
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('MongoDB disconnected');
      isConnected = false;
    });
  } catch (err) {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  }
}

export function getDB() {
  return mongoose.connection.db;
}

export default { connectDB, getDB };
