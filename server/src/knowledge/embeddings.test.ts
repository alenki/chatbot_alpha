import { describe, expect, it } from 'vitest'
import { embed } from './embeddings.js'

// Real-model smoke test. Guarded because the first run downloads the
// Xenova/multilingual-e5-small ONNX weights (>100 MB) to the local HF cache
// and inference is slow. CI and the default local run SKIP this suite.
// (Xenova/multilingual-e5-small is the ONNX distribution of the contract's
// intfloat/multilingual-e5-small family — see embeddings.ts for why the
// intfloat/... id cannot be loaded by transformers.js.)
// To run it:  pnpm --filter server exec cross-env RUN_EMBEDDING_TESTS=1 vitest run src/knowledge/embeddings.test.ts
describe.runIf(process.env.RUN_EMBEDDING_TESTS === '1')('embed — real model smoke test (slow)', () => {
  it(
    'returns 384-dim normalized vectors, distinguishes prefixes, ranks related text closer',
    async () => {
      const [query] = await embed(['сколько стоит доставка заказа'], 'query')
      const [related, unrelated] = await embed(
        [
          'Доставка по городу занимает 1-2 дня и стоит 300 рублей.',
          'Визитки печатаем на мелованной бумаге плотностью 300 г/м².',
        ],
        'passage',
      )

      // e5-small output dimension
      expect(query).toHaveLength(384)
      expect(related).toHaveLength(384)
      expect(unrelated).toHaveLength(384)

      // normalize: true → unit L2 norm
      const norm = Math.sqrt(query!.reduce((s, v) => s + v * v, 0))
      expect(norm).toBeCloseTo(1, 4)

      // semantically related passage is closer to the query (dot product of unit vectors = cosine similarity)
      const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i]!, 0)
      expect(dot(query!, related!)).toBeGreaterThan(dot(query!, unrelated!))

      // e5 prefix convention: the same text embeds differently as query vs passage
      const [asQuery] = await embed(['доставка'], 'query')
      const [asPassage] = await embed(['доставка'], 'passage')
      expect(asQuery).not.toEqual(asPassage)
    },
    600_000, // generous per-test timeout: first run includes the model download
  )
})
