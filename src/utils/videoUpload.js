/**
 * src/utils/videoUpload.js
 *
 * Handles video upload to Cloudinary.
 * Uses upload_stream so the file is piped directly from memory/disk
 * without writing a second copy — critical for large video files.
 *
 * Cloudinary free tier: 500 MB storage, 10 GB bandwidth/month.
 * For production use the Pro plan or switch CLOUD_VIDEO_PROVIDER
 * to Backblaze B2 / AWS S3 (swap this file only).
 */

import { v2 as cloudinary } from 'cloudinary';
import { Readable }         from 'stream';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Upload a video buffer or readable stream to Cloudinary.
 *
 * @param {Buffer|Readable} source   - Raw video data
 * @param {object}          meta     - { returnId, boxId, sessionTimestamp }
 * @returns {Promise<{url, publicId, duration, bytes, format}>}
 */
export const uploadVideoToCloud = (source, meta = {}) =>
  new Promise((resolve, reject) => {
    const folder    = `cartify/returns/${meta.returnId || 'unknown'}`;
    const publicId  = `box-${meta.boxId || 'x'}-${meta.sessionTimestamp || Date.now()}`;

    const uploadOptions = {
      resource_type: 'video',
      folder,
      public_id:     publicId,
      overwrite:     false,            // never silently overwrite an existing recording
      chunk_size:    6 * 1024 * 1024,  // 6 MB chunks — Cloudinary recommended minimum
      eager: [
        // Generate a low-res preview thumbnail at 5 s mark for the admin dashboard
        { width: 320, height: 240, crop: 'pad', start_offset: '5', format: 'jpg' },
      ],
      eager_async:  true,              // thumbnails generated async — don't block response
      context: {
        return_id:   meta.returnId   || '',
        box_id:      meta.boxId      || '',
        uploaded_at: new Date().toISOString(),
      },
      // Hard cap: reject files over 500 MB before Cloudinary does
      // (actual enforcement is in the multer middleware)
    };

    const stream = cloudinary.uploader.upload_stream(
      uploadOptions,
      (error, result) => {
        if (error) return reject(error);
        resolve({
          url:       result.secure_url,
          publicId:  result.public_id,
          duration:  result.duration  || 0,   // seconds
          bytes:     result.bytes     || 0,
          format:    result.format    || 'mp4',
          thumbnail: result.eager?.[0]?.secure_url || null,
        });
      }
    );

    // Accept both a Buffer and a Readable stream from the caller
    if (Buffer.isBuffer(source)) {
      const readable = new Readable();
      readable.push(source);
      readable.push(null);
      readable.pipe(stream);
    } else {
      // Already a Readable (e.g. from multer disk storage)
      source.pipe(stream);
    }
  });

/**
 * Delete a video from Cloudinary (used when a return is cancelled
 * or an upload needs to be retried after a corrupt upload).
 *
 * @param {string} publicId
 */
export const deleteVideoFromCloud = (publicId) =>
  cloudinary.uploader.destroy(publicId, { resource_type: 'video' });
