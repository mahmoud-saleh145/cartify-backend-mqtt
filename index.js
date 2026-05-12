import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';

import connectToDB from './db/connectionDB.js';
import { globalErrorHandler, AppError } from './src/utils/error.js';
import { initMqtt } from './src/modules/mqtt/mqtt.service.js';

// ── Route imports ─────────────────────────────────────────────────────────────
import productRouter from './src/modules/product/product.routes.js';
import categoryRouter from './src/modules/category/category.routes.js';
import userRouter from './src/modules/user/user.routes.js';
import cartRouter from './src/modules/cart/cart.routes.js';
import wishlistRouter from './src/modules/wishlist/wishlist.routes.js';
import orderRouter from './src/modules/order/order.routes.js';
import reviewRouter from './src/modules/review/review.routes.js';
import returnRouter from './src/modules/return/return.routes.js';

// ── App ───────────────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3001;

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim());

app.use(cors({
  // origin: (origin, cb) => {
  //   if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
  //   cb(new Error(`CORS: origin ${origin} not allowed`));
  // },
  // credentials: true,
}));

// ── Core middleware ───────────────────────────────────────────────────────────
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/', (_req, res) =>
  res.json({ msg: 'Cartify API is running 🛒', version: '1.0.0', env: process.env.NODE_ENV })
);
app.get('/health', (_req, res) =>
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
);

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/products', productRouter);
app.use('/categories', categoryRouter);
app.use('/users', userRouter);
app.use('/cart', cartRouter);
app.use('/wishlist', wishlistRouter);
app.use('/orders', orderRouter);
app.use('/reviews', reviewRouter);
app.use('/returns', returnRouter);

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, _res, next) =>
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404))
);

// ── Global error handler ──────────────────────────────────────────────────────
app.use(globalErrorHandler);

// ── Start ─────────────────────────────────────────────────────────────────────
const startServer = async () => {
  try {
    await connectToDB();

    app.listen(PORT, () => {
      console.log(`🚀  Cartify API → http://localhost:${PORT}`);
      console.log(`📦  Environment: ${process.env.NODE_ENV || 'development'}`);
    });

    // ── MQTT — initialised after DB is ready so handlers can query MongoDB ──
    initMqtt();

  } catch (err) {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  }
};

startServer();

export default app;
