import { z } from "zod";

// Shared path-param schema for the project subroutes — a malformed id is a
// 400 about the request shape before any database round-trip, and the value
// is never echoed back.
export const idParamSchema = z.object({ id: z.uuid() });
