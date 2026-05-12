import mongoose from 'mongoose';

let cached = global._mongooseCache;
if (!cached) {
  cached = global._mongooseCache = { conn: null, promise: null };
}

const connectToDB = async () => {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    const uri =
      process.env.NODE_ENV === 'production'
        ? process.env.DB_URL_ONLINE
        : process.env.DB_URL || process.env.DB_URL_ONLINE;

    cached.promise = mongoose
      .connect(uri, { serverSelectionTimeoutMS: 10000 })
      .then((m) => {
        console.log('✅  MongoDB connected');
        return m;
      })
      .catch((err) => {
        cached.promise = null;
        console.error('❌  MongoDB connection failed:', err.message);
        throw err;
      });
  }

  cached.conn = await cached.promise;
  return cached.conn;
};

export default connectToDB;
