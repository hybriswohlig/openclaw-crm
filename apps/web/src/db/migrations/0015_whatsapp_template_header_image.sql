-- Add header_image_url for WhatsApp templates whose HEADER component is an
-- image. Meta rejects sends that omit the header component when the approved
-- template includes one (error #132012), so we persist the public URL here
-- and reuse it on every send.

ALTER TABLE "whatsapp_template_metadata"
  ADD COLUMN IF NOT EXISTS "header_image_url" text;
