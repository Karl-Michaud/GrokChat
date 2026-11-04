import { z } from "zod";

export const postSchema = z.object({ id: z.string() });
