/**
 * src/modules/mqtt/mqtt.service.js
 *
 * Smart Return Box MQTT integration.
 *
 * Topic contract:
 *   SUBSCRIBE  box/+/request          ← box sends scanned code
 *   PUBLISH    box/{boxId}/command    ← backend sends open / deny / expired / used
 *
 * Payload in:   { "code": "ABC123" }
 * Payload out:  { "action": "open" | "deny" | "expired" | "used" }
 */

import mqtt        from 'mqtt';
import returnModel from '../../../db/models/return.model.js';
import connectToDB from '../../../db/connectionDB.js';

// ── Topic helpers ─────────────────────────────────────────────────────────────

const REQUEST_TOPIC  = 'box/+/request';       // wildcard subscription
const commandTopic   = (boxId) => `box/${boxId}/command`;

// ── Publish helper ────────────────────────────────────────────────────────────

/**
 * Publish a command payload to a specific box.
 * Fire-and-forget — errors are logged but never thrown so the MQTT loop
 * never crashes the server.
 *
 * @param {mqtt.MqttClient} client
 * @param {string}          boxId
 * @param {'open'|'deny'|'expired'|'used'} action
 */
const publish = (client, boxId, action) => {
  const topic   = commandTopic(boxId);
  const payload = JSON.stringify({ action });

  client.publish(topic, payload, { qos: 1 }, (err) => {
    if (err) {
      console.error(`[MQTT] ❌  Failed to publish to ${topic}:`, err.message);
    } else {
      console.log(`[MQTT] 📤  ${topic} → ${payload}`);
    }
  });
};

// ── Validation logic ──────────────────────────────────────────────────────────

/**
 * Core handler — called for every validated incoming message.
 * Matches the exact flow described in the feature spec:
 *
 *   not found  → deny
 *   expired    → expired
 *   not pending → used
 *   valid      → open  +  mark completed
 *
 * @param {mqtt.MqttClient} client
 * @param {string}          boxId   extracted from topic
 * @param {string}          code    from parsed JSON payload
 */
const handleReturnRequest = async (client, boxId, code) => {
  // Ensure Mongoose connection is ready (MQTT may fire before HTTP does)
  await connectToDB();

  const upperCode = code.trim().toUpperCase();

  // Single indexed query — compound index { code, status } makes this fast
  const returnRequest = await returnModel.findOne({ code: upperCode });

  // ── 1. Code not found ─────────────────────────────────────────────────────
  if (!returnRequest) {
    console.log(`[MQTT] ⚠️   Box ${boxId} — code "${upperCode}" not found → deny`);
    publish(client, boxId, 'deny');
    return;
  }

  // ── 2. Code expired (expiresAt in the past) ───────────────────────────────
  if (new Date() > returnRequest.expiresAt) {
    console.log(`[MQTT] ⏰  Box ${boxId} — code "${upperCode}" expired → expired`);

    // Lazily mark expired in DB so subsequent REST calls show the right status
    if (returnRequest.status === 'pending') {
      returnRequest.status = 'expired';
      await returnRequest.save().catch((err) =>
        console.error('[MQTT] DB update (expired) failed:', err.message)
      );
    }

    publish(client, boxId, 'expired');
    return;
  }

  // ── 3. Already used / not pending ─────────────────────────────────────────
  if (returnRequest.status !== 'pending') {
    console.log(`[MQTT] 🔁  Box ${boxId} — code "${upperCode}" already ${returnRequest.status} → used`);
    publish(client, boxId, 'used');
    return;
  }

  // ── 4. Valid — open the box and mark completed ────────────────────────────
  console.log(`[MQTT] ✅  Box ${boxId} — code "${upperCode}" valid → open`);
  publish(client, boxId, 'open');

  returnRequest.status         = 'completed';
  returnRequest.processedByBox = boxId;
  returnRequest.completedAt    = new Date();

  await returnRequest.save().catch((err) =>
    console.error('[MQTT] DB update (completed) failed:', err.message)
  );
};

// ── Message dispatcher ────────────────────────────────────────────────────────

/**
 * Process a raw MQTT message arriving on box/+/request.
 *
 * Handles:
 *  - wrong topic format (safety — should never happen with a correct broker ACL)
 *  - malformed JSON
 *  - missing or non-string code field
 *  - any DB error (caught, logged, deny published so the box isn't left hanging)
 *
 * @param {mqtt.MqttClient} client
 * @param {string}          topic
 * @param {Buffer}          rawPayload
 */
const onMessage = async (client, topic, rawPayload) => {
  console.log(`[MQTT] 📥  ${topic} → ${rawPayload.toString()}`);

  // ── Extract boxId from "box/{boxId}/request" ──────────────────────────────
  const parts = topic.split('/');
  if (parts.length !== 3 || parts[0] !== 'box' || parts[2] !== 'request') {
    console.warn(`[MQTT] ⚠️   Unexpected topic format: "${topic}" — ignoring`);
    return;
  }
  const boxId = parts[1];

  // ── Parse JSON payload safely ─────────────────────────────────────────────
  let payload;
  try {
    payload = JSON.parse(rawPayload.toString());
  } catch {
    console.error(`[MQTT] ❌  Box ${boxId} — malformed JSON payload → deny`);
    publish(client, boxId, 'deny');
    return;
  }

  // ── Validate code field ───────────────────────────────────────────────────
  const { code } = payload;
  if (!code || typeof code !== 'string' || !code.trim()) {
    console.error(`[MQTT] ❌  Box ${boxId} — missing or empty code field → deny`);
    publish(client, boxId, 'deny');
    return;
  }

  // ── Run validation (DB errors are caught here so box always gets a reply) ──
  try {
    await handleReturnRequest(client, boxId, code);
  } catch (err) {
    console.error(`[MQTT] 💥  Box ${boxId} — unexpected error:`, err.message);
    publish(client, boxId, 'deny');
  }
};

// ── Client factory ────────────────────────────────────────────────────────────

/**
 * Build the mqtt.connect options object from environment variables.
 * Kept separate so it is easy to extend (TLS certs, will message, etc.)
 */
const buildConnectOptions = () => {
  const options = {
    clientId:      `cartify-server-${process.pid}`,
    clean:         true,
    reconnectPeriod: 5000,     // auto-reconnect every 5 s on disconnect
    connectTimeout:  10000,    // fail fast if broker unreachable at startup
    keepalive:       60,
  };

  if (process.env.MQTT_USERNAME) options.username = process.env.MQTT_USERNAME;
  if (process.env.MQTT_PASSWORD) options.password = process.env.MQTT_PASSWORD;

  return options;
};

// ── Public initialiser ────────────────────────────────────────────────────────

/**
 * Connect to the MQTT broker and wire up all event handlers.
 * Called once at application startup (from index.js).
 *
 * Returns the connected client so callers can use it for manual publishes
 * if needed in the future (e.g. admin-triggered commands).
 *
 * @returns {mqtt.MqttClient}
 */
export const initMqtt = () => {
  const brokerUrl = process.env.MQTT_BROKER_URL;

  if (!brokerUrl) {
    console.warn('[MQTT] ⚠️   MQTT_BROKER_URL not set — MQTT service disabled');
    return null;
  }

  console.log(`[MQTT] 🔌  Connecting to broker: ${brokerUrl}`);

  const client = mqtt.connect(brokerUrl, buildConnectOptions());

  // ── Connected ─────────────────────────────────────────────────────────────
  client.on('connect', () => {
    console.log('[MQTT] 🟢  Connected to broker');

    client.subscribe(REQUEST_TOPIC, { qos: 1 }, (err, granted) => {
      if (err) {
        console.error('[MQTT] ❌  Subscription failed:', err.message);
      } else {
        const topics = granted.map((g) => `${g.topic} (QoS ${g.qos})`).join(', ');
        console.log(`[MQTT] 📋  Subscribed → ${topics}`);
      }
    });
  });

  // ── Message received ──────────────────────────────────────────────────────
  client.on('message', (topic, rawPayload) => {
    // onMessage is async — errors are caught inside, never propagate here
    onMessage(client, topic, rawPayload);
  });

  // ── Reconnecting ──────────────────────────────────────────────────────────
  client.on('reconnect', () => {
    console.log('[MQTT] 🔄  Reconnecting to broker…');
  });

  // ── Disconnected ──────────────────────────────────────────────────────────
  client.on('offline', () => {
    console.warn('[MQTT] 🔴  Client went offline — will retry automatically');
  });

  // ── Error ─────────────────────────────────────────────────────────────────
  client.on('error', (err) => {
    // Logged but not thrown — the mqtt library handles reconnects internally
    console.error('[MQTT] ❌  Client error:', err.message);
  });

  // ── Close ─────────────────────────────────────────────────────────────────
  client.on('close', () => {
    console.warn('[MQTT] 🔌  Connection closed');
  });

  return client;
};
