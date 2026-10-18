// © 2026 VIP-saksham · Wordraft Game Bot · All Rights Reserved.
import IORedis from "ioredis";

import { env } from "./env";

export const redis = new IORedis(env.REDIS_URI);
