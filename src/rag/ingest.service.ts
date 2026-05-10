import { Injectable } from '@nestjs/common';
import { CheerioWebBaseLoader } from '@langchain/community/document_loaders/web/cheerio';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { Document } from '@langchain/core/documents';
import { MemoryVectorStore } from '@langchain/classic/vectorstores/memory';
import { LocalHashEmbeddings } from './local-hash-embeddings';

type IngestTextMetadata = Record<string, string | number | boolean | null>;

@Injectable()
export class IngestService {
    private vectorStore: MemoryVectorStore | null = null;

    getVectorStore() {
        return this.vectorStore;
    }

    async ingestText(text: string, metadata: IngestTextMetadata = {}) {
        try {
            const normalizedText = text.trim();

            if (!normalizedText) {
                throw new Error('Transcript text is empty.');
            }

            console.log('Building in-memory vector store from transcript text...');
            const embeddings = new LocalHashEmbeddings();
            const docs = [
                new Document({
                    pageContent: normalizedText,
                    metadata,
                }),
            ];

            const textSplitter = new RecursiveCharacterTextSplitter({
                separators: ['\n\n', '\n', '.', ',', ' '],
                chunkSize: 1000,
                chunkOverlap: 150,
            });
            const splitDocs = await textSplitter.splitDocuments(docs);
            this.vectorStore = await MemoryVectorStore.fromDocuments(
                splitDocs,
                embeddings,
            );

            return {
                status: 'done',
                message: 'Transcript ingestion complete',
                chunks: splitDocs.length,
            };
        } catch (error) {
            console.error('Error during transcript ingestion:', error);
            throw error;
        }
    }

    async ingest(urls: string[]) {
        try {
            console.log('Building in-memory vector store...');
            const embeddings = new LocalHashEmbeddings();

            // 1. Load data
            const docs: Document[] = [];
            for (const url of urls) {
                try {
                    const loader = new CheerioWebBaseLoader(url);
                    const loadedDocs = await loader.load();
                    docs.push(...loadedDocs);
                } catch (e) {
                    console.error(`Failed to load ${url}:`, e);
                }
            }

            if (docs.length === 0) {
                throw new Error('Could not extract content from the provided URLs.');
            }

            // 2. Split data
            const textSplitter = new RecursiveCharacterTextSplitter({
                separators: ['\n\n', '\n', '.', ','],
                chunkSize: 1000,
            });
            const splitDocs = await textSplitter.splitDocuments(docs);

            // 3. Create embeddings and keep them available for the current app process
            this.vectorStore = await MemoryVectorStore.fromDocuments(
                splitDocs,
                embeddings,
            );

            return { status: 'done', message: 'Ingestion complete' };
        } catch (error) {
            console.error('Error during ingestion:', error);
            throw error;
        }
    }
}
