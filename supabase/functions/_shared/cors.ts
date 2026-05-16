// Shared CORS headers for browser-facing edge functions.
// Webhooks don't need these (server-to-server) but the checkout creator does.

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
