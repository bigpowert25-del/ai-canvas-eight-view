/**
 * @typedef {Object} UploadedImage
 * @property {Buffer} buffer
 * @property {string} originalname
 * @property {string} mimetype
 */

/**
 * Image provider contract used by the API routes.
 *
 * @typedef {Object} ImageProvider
 * @property {string} id
 * @property {(input: { reference: UploadedImage, prompt: string, quality: string, seed?: number }) => Promise<{ imageDataUrl: string, provider: string, model: string }>} generateContactSheet
 * @property {(input: { reference: UploadedImage, contextSheet?: UploadedImage, prompt: string, viewId: string, quality: string, seed?: number }) => Promise<{ imageDataUrl: string, provider: string, model: string }>} generateView
 */

export {};
