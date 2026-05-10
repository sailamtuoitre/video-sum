import { Embeddings } from '@langchain/core/embeddings';

export class LocalHashEmbeddings extends Embeddings {
  private readonly dimensions = 384;

  constructor() {
    super({});
  }

  async embedDocuments(documents: string[]) {
    return documents.map((document) => this.embed(document));
  }

  async embedQuery(document: string) {
    return this.embed(document);
  }

  private embed(text: string) {
    const vector = new Array<number>(this.dimensions).fill(0);
    const tokens = text
      .toLowerCase()
      .normalize('NFC')
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean);

    for (const token of tokens) {
      const hash = this.hash(token);
      const index = Math.abs(hash) % this.dimensions;
      vector[index] += hash < 0 ? -1 : 1;
    }

    const magnitude = Math.hypot(...vector);

    if (magnitude === 0) {
      return vector;
    }

    return vector.map((value) => value / magnitude);
  }

  private hash(value: string) {
    let hash = 0x811c9dc5;

    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }

    return hash | 0;
  }
}
