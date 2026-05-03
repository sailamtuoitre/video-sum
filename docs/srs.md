# Software Requirements Specification (SRS)
## AI Video Learning Assistant

**Version:** 1.0.0  
**Date:** 2026-05-03  
**Status:** Draft  

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Overall Description](#2-overall-description)
3. [Functional Requirements](#3-functional-requirements)
4. [Non-Functional Requirements](#4-non-functional-requirements)
5. [System Constraints](#5-system-constraints)
6. [Use Cases](#6-use-cases)
7. [Success Criteria](#7-success-criteria)

---

## 1. Introduction

### 1.1 Purpose

This document defines the software requirements for the **AI Video Learning Assistant** — a local-first, AI-powered web application that transforms YouTube videos into structured learning materials using Retrieval-Augmented Generation (RAG).

### 1.2 Problem Statement

Learners who consume educational video content face several obstacles:

- Videos are long-form and non-searchable by content
- No built-in mechanism for retention or active recall
- Cannot ask follow-up questions based on specific video content
- No auto-generated study aids (quizzes, flashcards)
- Hallucination risk when general-purpose chatbots answer about a specific video

### 1.3 Motivation

With the rise of online education (YouTube, MOOCs), there is a growing need for tools that:

- Extract knowledge from video content automatically
- Allow context-aware Q&A grounded **only** in the video's content
- Generate study materials (quizzes, flashcards) without manual effort
- Support Vietnamese language processing with high fidelity

### 1.4 Objectives

| # | Objective |
|---|---|
| O1 | Accept a YouTube URL and extract the full transcript |
| O2 | Generate a structured summary of the video |
| O3 | Enable a RAG-based chatbot that answers only from video content |
| O4 | Auto-generate multiple-choice quizzes from video content |
| O5 | Auto-generate flashcards for active recall |
| O6 | Support Vietnamese language at all AI processing layers |
| O7 | Operate entirely in a local development environment without Docker |

---

## 2. Overall Description

### 2.1 Product Perspective

The system is a standalone full-stack web application with:

- **Frontend:** React.js SPA
- **Backend:** NestJS REST API server
- **AI Layer:** LLM APIs + Embedding model + Vector Database
- **Storage:** Relational DB (SQLite/PostgreSQL) + Vector DB (Qdrant)

### 2.2 Product Functions (High-Level)

```
[User] → [YouTube URL Input]
           ↓
     [Transcript Extraction]
           ↓
     [Chunking + Embedding]
           ↓
     [Vector DB Storage]
           ↓
  ┌────────────────────────┐
  │  Summary Generation    │
  │  RAG Chatbot           │
  │  Quiz Generation       │
  │  Flashcard Generation  │
  └────────────────────────┘
```

### 2.3 User Classes

| User Class | Description |
|---|---|
| **Student** | Primary user; inputs video URLs, consumes learning materials |
| **Self-learner** | Uses chatbot and quizzes for independent study |
| **Educator** | May use quiz/flashcard generation for course prep |

### 2.4 Operating Environment

- **OS:** Windows / macOS / Linux (local machine)
- **Node.js:** v18+
- **Runtime:** Local dev server (no Docker, no cloud deployment)
- **Network:** Internet required for YouTube transcript fetching and LLM API calls

---

## 3. Functional Requirements

### 3.1 Video Ingestion

| ID | Requirement |
|---|---|
| FR-V01 | The system SHALL accept a valid YouTube URL as input |
| FR-V02 | The system SHALL validate the URL format before processing |
| FR-V03 | The system SHALL extract the video transcript using YouTube's caption API |
| FR-V04 | If captions are unavailable, the system SHALL use speech-to-text (Whisper or equivalent) |
| FR-V05 | The system SHALL store the raw transcript associated with the video ID |
| FR-V06 | The system SHALL prevent duplicate processing of the same video ID |

### 3.2 Transcript Processing (RAG Pipeline)

| ID | Requirement |
|---|---|
| FR-T01 | The system SHALL split the transcript into semantic chunks |
| FR-T02 | Each chunk SHALL have a configurable size (default: 500 tokens, overlap: 50 tokens) |
| FR-T03 | The system SHALL generate vector embeddings for each chunk |
| FR-T04 | Embeddings SHALL be stored in the vector database with video ID metadata |
| FR-T05 | The system SHALL support re-indexing when a video is reprocessed |

### 3.3 Summary Generation

| ID | Requirement |
|---|---|
| FR-S01 | The system SHALL generate a structured summary upon video processing completion |
| FR-S02 | The summary SHALL include: key points (bullet list), simplified explanation, main topics |
| FR-S03 | The summary SHALL be stored and retrievable without reprocessing |
| FR-S04 | The system SHALL support Vietnamese-language summaries |

### 3.4 RAG Chatbot

| ID | Requirement |
|---|---|
| FR-C01 | The system SHALL provide a chat interface tied to a specific video |
| FR-C02 | Each user query SHALL trigger a vector similarity search over that video's chunks |
| FR-C03 | The top-K retrieved chunks SHALL be injected as context into the LLM prompt |
| FR-C04 | The LLM SHALL be instructed to answer ONLY from provided context |
| FR-C05 | If the answer is not in the context, the system SHALL respond: "Thông tin này không có trong video" |
| FR-C06 | Chat history SHALL be maintained per session |
| FR-C07 | The system SHALL display source chunk references with each answer |

### 3.5 Quiz Generation

| ID | Requirement |
|---|---|
| FR-Q01 | The system SHALL auto-generate multiple-choice questions from the video content |
| FR-Q02 | Each question SHALL have 4 options with exactly 1 correct answer |
| FR-Q03 | The system SHALL generate a configurable number of questions (default: 10) |
| FR-Q04 | Questions SHALL cover diverse topics across the video |
| FR-Q05 | The system SHALL store quizzes and allow re-generation |

### 3.6 Flashcard Generation

| ID | Requirement |
|---|---|
| FR-F01 | The system SHALL auto-generate flashcards (Q&A pairs) from the video |
| FR-F02 | Each flashcard SHALL have a front (question/concept) and back (answer/explanation) |
| FR-F03 | The system SHALL generate a configurable number of flashcards (default: 15) |
| FR-F04 | Flashcards SHALL be reviewable in a flip-card UI |

---

## 4. Non-Functional Requirements

### 4.1 Performance

| ID | Requirement |
|---|---|
| NFR-P01 | Transcript extraction SHALL complete within 30 seconds for videos under 60 minutes |
| NFR-P02 | Embedding generation SHALL complete within 60 seconds for a 60-minute video |
| NFR-P03 | Chatbot responses SHALL be returned within 5 seconds per query |
| NFR-P04 | Summary generation SHALL complete within 20 seconds |

### 4.2 Reliability

| ID | Requirement |
|---|---|
| NFR-R01 | The system SHALL handle LLM API timeouts with retry logic (max 3 retries) |
| NFR-R02 | Failed processing jobs SHALL be retried automatically via the queue system |
| NFR-R03 | The system SHALL not lose stored video data on server restart |

### 4.3 Accuracy

| ID | Requirement |
|---|---|
| NFR-A01 | Chatbot answer accuracy SHALL be ≥ 90% based on retrieved context |
| NFR-A02 | The system SHALL not hallucinate information outside the video context |
| NFR-A03 | Quiz questions SHALL be factually grounded in video content |

### 4.4 Usability

| ID | Requirement |
|---|---|
| NFR-U01 | The UI SHALL be responsive and usable on desktop browsers |
| NFR-U02 | All error states SHALL display clear, actionable messages |
| NFR-U03 | Processing status SHALL be shown in real-time to the user |

### 4.5 Maintainability

| ID | Requirement |
|---|---|
| NFR-M01 | Code SHALL follow TypeScript strict mode |
| NFR-M02 | All modules SHALL be independently testable |
| NFR-M03 | Environment configuration SHALL use `.env` files |

---

## 5. System Constraints

| Constraint | Detail |
|---|---|
| **No Docker** | The system must run directly on the host machine without containerization |
| **Local only** | No production deployment; runs on localhost |
| **Vietnamese support** | All AI models selected must perform well on Vietnamese text |
| **No cloud storage** | Data stays on local disk / local DB |
| **API key security** | LLM/embedding API keys stored in `.env`, never committed to version control |

---

## 6. Use Cases

### UC-01: Process New Video

**Actor:** Student  
**Precondition:** User has a valid YouTube URL  
**Flow:**
1. User enters YouTube URL
2. System validates URL
3. System extracts transcript
4. System chunks and embeds transcript
5. System generates summary
6. System confirms completion and presents learning options

**Postcondition:** Video data stored; all features available

---

### UC-02: Chat with Video

**Actor:** Student  
**Precondition:** Video has been processed  
**Flow:**
1. User types a question in the chat interface
2. System embeds the question
3. System retrieves top-K relevant chunks
4. System sends prompt + context to LLM
5. System returns answer with source references

---

### UC-03: Take a Quiz

**Actor:** Student  
**Precondition:** Video has been processed  
**Flow:**
1. User requests quiz generation
2. System generates N multiple-choice questions
3. User answers questions
4. System scores and provides feedback

---

### UC-04: Review Flashcards

**Actor:** Student  
**Precondition:** Video has been processed  
**Flow:**
1. User requests flashcard generation
2. System generates N flashcards
3. User flips cards to review

---

## 7. Success Criteria

| Criterion | Metric |
|---|---|
| Summary completeness | Covers all major topics from the video |
| Chatbot groundedness | Answers only from video context; no hallucination |
| Chatbot accuracy | ≥ 90% factually correct answers based on retrieved context |
| Quiz quality | Questions are diverse and grounded in video content |
| Flashcard quality | Clear, concise Q&A pairs for effective memorization |
| Vietnamese fidelity | No degradation in quality for Vietnamese-language videos |
| Processing time | Full pipeline (transcript → embeddings) < 90 seconds for 60-min video |
