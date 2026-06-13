import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers'

// The contract names this model `intfloat/multilingual-e5-small` (384-dim).
// transformers.js loads ONNX weights, but the intfloat/ repo ships only PyTorch
// weights (no ONNX) and is therefore NOT loadable here. Xenova/multilingual-e5-small
// is the ONNX distribution of that exact same 384-dim model, so we use that id.
// DO NOT replace this with 'intfloat/multilingual-e5-small' — the pipeline would
// fail to resolve ONNX weights at runtime.
const MODEL_ID = 'Xenova/multilingual-e5-small'

// Lazy singleton: the model (large download, cached after the first run) is
// only loaded on the first embed() call — importing this module stays cheap,
// which also keeps the guarded test file importable in default (skipped) runs.
let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null

function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (pipelinePromise === null) {
    pipelinePromise = pipeline('feature-extraction', MODEL_ID) as Promise<FeatureExtractionPipeline>
  }
  return pipelinePromise
}

/**
 * Embed texts with the e5 prefix convention: search queries are prefixed
 * "query: ", documents/chunks are prefixed "passage: ". Returns one
 * L2-normalized 384-dim vector per input text (mean pooling).
 */
export async function embed(texts: string[], kind: 'query' | 'passage'): Promise<number[][]> {
  if (texts.length === 0) return []
  const pipe = await getPipeline()
  const prefixed = texts.map((t) => `${kind}: ${t}`)
  const output = await pipe(prefixed, { pooling: 'mean', normalize: true })
  return output.tolist() as number[][]
}
