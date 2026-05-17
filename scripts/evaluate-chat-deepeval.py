#!/usr/bin/env python

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


DEFAULT_API_BASE_URL = "http://localhost:3000"
DEFAULT_EVAL_SET = "scripts/chat-eval.sample.json"
DEFAULT_MODEL = "gpt-4.1"
PLACEHOLDER_VIDEO_IDS = {"replace-with-video-id", "<video-id>", "video-id"}


def load_env_file(path=".env"):
    env_path = Path(path)
    if not env_path.exists():
        return

    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue

        key, value = stripped.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


class GroqDeepEvalModel:
    def __init__(self, model):
        try:
            from deepeval.models.base_model import DeepEvalBaseLLM
            from openai import AsyncOpenAI, OpenAI
        except ImportError as exc:
            raise RuntimeError(
                "Groq judge mode requires deepeval and openai in the Python environment."
            ) from exc

        class _GroqModel(DeepEvalBaseLLM):
            def __init__(self, model_name):
                self.model_name = model_name
                self.client = OpenAI(
                    api_key=os.getenv("GROQ_API_KEY"),
                    base_url=os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1"),
                )
                self.async_client = AsyncOpenAI(
                    api_key=os.getenv("GROQ_API_KEY"),
                    base_url=os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1"),
                )
                super().__init__(model_name)

            def load_model(self):
                return self.client

            def get_model_name(self):
                return f"groq:{self.model_name}"

            def supports_json_mode(self):
                return True

            def generate(self, prompt, schema=None):
                if not os.getenv("GROQ_API_KEY"):
                    raise RuntimeError("GROQ_API_KEY is required for Groq DeepEval judge mode.")

                kwargs = self._request_kwargs(prompt, schema)
                response = self.client.chat.completions.create(**kwargs)
                content = response.choices[0].message.content or ""
                return self._parse_schema(content, schema)

            async def a_generate(self, prompt, schema=None):
                if not os.getenv("GROQ_API_KEY"):
                    raise RuntimeError("GROQ_API_KEY is required for Groq DeepEval judge mode.")

                kwargs = self._request_kwargs(prompt, schema)
                response = await self.async_client.chat.completions.create(**kwargs)
                content = response.choices[0].message.content or ""
                return self._parse_schema(content, schema)

            def _request_kwargs(self, prompt, schema):
                messages = [
                    {
                        "role": "system",
                        "content": "Return only valid JSON when a JSON schema is requested.",
                    },
                    {"role": "user", "content": str(prompt)},
                ]
                kwargs = {
                    "model": self.model_name,
                    "messages": messages,
                    "temperature": 0,
                    "max_tokens": int(os.getenv("DEEPEVAL_JUDGE_MAX_TOKENS", "4096")),
                }

                if schema is not None:
                    kwargs["response_format"] = {"type": "json_object"}

                return kwargs

            def _parse_schema(self, content, schema):
                if schema is None:
                    return content

                if hasattr(schema, "model_validate_json"):
                    return schema.model_validate_json(content)

                return schema.parse_raw(content)

        self.model = _GroqModel(model)

    def __getattr__(self, name):
        return getattr(self.model, name)


def load_deepeval():
    try:
        from deepeval.metrics import (
            AnswerRelevancyMetric,
            ContextualPrecisionMetric,
            ContextualRecallMetric,
            ContextualRelevancyMetric,
            FaithfulnessMetric,
            SummarizationMetric,
        )
        from deepeval.test_case import LLMTestCase
    except ImportError as exc:
        raise RuntimeError(
            "Missing deepeval. Install it with: python -m pip install -r requirements-deepeval.txt"
        ) from exc

    return {
        "LLMTestCase": LLMTestCase,
        "AnswerRelevancyMetric": AnswerRelevancyMetric,
        "ContextualPrecisionMetric": ContextualPrecisionMetric,
        "ContextualRecallMetric": ContextualRecallMetric,
        "ContextualRelevancyMetric": ContextualRelevancyMetric,
        "FaithfulnessMetric": FaithfulnessMetric,
        "SummarizationMetric": SummarizationMetric,
    }


def request_json(url, method="GET", payload=None):
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method=method,
        headers={"content-type": "application/json"},
    )

    try:
        with urllib.request.urlopen(request) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} from {url}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Cannot reach {url}: {exc.reason}") from exc

    return json.loads(raw) if raw else None


def create_session(api_base_url, video_id, title):
    return request_json(
        f"{api_base_url}/chat-sessions",
        method="POST",
        payload={"videoId": video_id, "title": title},
    )


def ask_question(api_base_url, session_id, question):
    return request_json(
        f"{api_base_url}/chat-messages/ask",
        method="POST",
        payload={"sessionId": session_id, "content": question},
    )


def create_summary(api_base_url, video_id):
    return request_json(
        f"{api_base_url}/summaries/from-video/{video_id}",
        method="POST",
    )


def get_summary(api_base_url, summary_id):
    return request_json(f"{api_base_url}/summaries/{summary_id}")


def get_chunks(api_base_url, video_id):
    chunks = request_json(f"{api_base_url}/chunks?videoId={video_id}")
    return chunks if isinstance(chunks, list) else []


def retrieval_context(response):
    chunks = response.get("retrievedChunks")
    if not isinstance(chunks, list):
        return []

    context = []
    for chunk in chunks:
        if isinstance(chunk, dict):
            content = chunk.get("content")
            if isinstance(content, str) and content.strip():
                context.append(content.strip())
        elif isinstance(chunk, str) and chunk.strip():
            context.append(chunk.strip())

    return context


def build_rag_metrics(classes, metric_names, threshold, model):
    metric_map = {
        "answer_relevancy": classes["AnswerRelevancyMetric"],
        "faithfulness": classes["FaithfulnessMetric"],
        "contextual_relevancy": classes["ContextualRelevancyMetric"],
        "contextual_precision": classes["ContextualPrecisionMetric"],
        "contextual_recall": classes["ContextualRecallMetric"],
    }

    metrics = []
    for name in metric_names:
        metric_class = metric_map.get(name)
        if metric_class is None:
            raise RuntimeError(f"Unsupported metric: {name}")

        metrics.append(
            metric_class(
                threshold=threshold,
                model=model,
                include_reason=True,
            )
        )

    return metrics


def build_summary_metrics(classes, threshold, model, assessment_questions, truths_extraction_limit):
    kwargs = {
        "threshold": threshold,
        "model": model,
        "include_reason": True,
    }

    if assessment_questions:
        kwargs["assessment_questions"] = assessment_questions

    if truths_extraction_limit:
        kwargs["truths_extraction_limit"] = truths_extraction_limit

    return [classes["SummarizationMetric"](**kwargs)]


def metric_result(metric):
    result = {
        "name": metric.__class__.__name__,
        "score": getattr(metric, "score", None),
        "threshold": getattr(metric, "threshold", None),
        "success": getattr(metric, "success", None),
        "reason": getattr(metric, "reason", None),
    }

    score_breakdown = getattr(metric, "score_breakdown", None)
    if score_breakdown is not None:
        result["scoreBreakdown"] = score_breakdown

    return result


def evaluate_rag_case(classes, test_case_config, response, metric_names, threshold, model):
    LLMTestCase = classes["LLMTestCase"]
    question = test_case_config["question"]
    actual_output = str(response.get("answer") or "")
    context = retrieval_context(response)
    expected_output = test_case_config.get("expectedOutput")

    kwargs = {
        "input": question,
        "actual_output": actual_output,
        "retrieval_context": context,
    }

    if expected_output:
        kwargs["expected_output"] = expected_output

    test_case = LLMTestCase(**kwargs)
    metrics = build_rag_metrics(classes, metric_names, threshold, model)

    results = []
    for metric in metrics:
        metric.measure(test_case)
        results.append(metric_result(metric))

    numeric_scores = [
        result["score"]
        for result in results
        if isinstance(result.get("score"), (int, float))
    ]

    return {
        "id": test_case_config.get("id", question),
        "question": question,
        "expectedOutput": expected_output,
        "answer": actual_output,
        "retrievalContextCount": len(context),
        "averageScore": round(sum(numeric_scores) / len(numeric_scores), 4)
        if numeric_scores
        else None,
        "metrics": results,
    }


def chunk_context_from_chunks(chunks):
    context = []
    for chunk in sorted(chunks, key=lambda item: item.get("chunkIndex", 0)):
        content = chunk.get("content") if isinstance(chunk, dict) else None
        if isinstance(content, str) and content.strip():
            context.append(content.strip())

    return context


def summary_output(summary):
    key_points = summary.get("keyPoints")
    main_topics = summary.get("mainTopics")

    parts = []
    simplified_text = summary.get("simplifiedText")
    if isinstance(simplified_text, str) and simplified_text.strip():
        parts.append(f"Simplified text:\n{simplified_text.strip()}")

    if isinstance(key_points, list) and key_points:
        parts.append("Key points:\n" + "\n".join(f"- {item}" for item in key_points))

    if isinstance(main_topics, list) and main_topics:
        parts.append("Main topics:\n" + "\n".join(f"- {item}" for item in main_topics))

    return "\n\n".join(parts)


def evaluate_summary(classes, summary, chunks, eval_set, threshold, model):
    LLMTestCase = classes["LLMTestCase"]
    context = chunk_context_from_chunks(chunks)
    original_text = "\n\n".join(context)
    actual_output = summary_output(summary)

    if not original_text:
        raise RuntimeError("No source chunks found for summary evaluation.")

    if not actual_output:
        raise RuntimeError("Summary output is empty.")

    test_case = LLMTestCase(input=original_text, actual_output=actual_output)
    metrics = build_summary_metrics(
        classes,
        threshold,
        model,
        eval_set.get("summaryAssessmentQuestions"),
        eval_set.get("truthsExtractionLimit"),
    )

    results = []
    for metric in metrics:
        metric.measure(test_case)
        results.append(metric_result(metric))

    numeric_scores = [
        result["score"]
        for result in results
        if isinstance(result.get("score"), (int, float))
    ]

    return {
        "id": "summary",
        "videoId": summary.get("videoId"),
        "summaryId": summary.get("id"),
        "sourceChunkCount": len(context),
        "actualOutput": actual_output,
        "averageScore": round(sum(numeric_scores) / len(numeric_scores), 4)
        if numeric_scores
        else None,
        "metrics": results,
    }


def parse_args():
    parser = argparse.ArgumentParser(
        description="Evaluate video RAG QA and summaries with DeepEval metrics."
    )
    parser.add_argument(
        "--mode",
        choices=["rag", "summarize", "all"],
        default=os.getenv("DEEPEVAL_MODE", "rag"),
    )
    parser.add_argument("--api-base-url", default=os.getenv("API_BASE_URL", DEFAULT_API_BASE_URL))
    parser.add_argument("--eval-set", default=os.getenv("EVAL_SET", DEFAULT_EVAL_SET))
    parser.add_argument("--session-id", default=os.getenv("SESSION_ID"))
    parser.add_argument("--video-id", default=os.getenv("VIDEO_ID"))
    parser.add_argument("--summary-id", default=os.getenv("SUMMARY_ID"))
    parser.add_argument("--out", default=os.getenv("EVAL_OUT"))
    parser.add_argument("--model", default=os.getenv("DEEPEVAL_MODEL", DEFAULT_MODEL))
    parser.add_argument("--threshold", type=float, default=float(os.getenv("DEEPEVAL_THRESHOLD", "0.7")))
    parser.add_argument(
        "--truths-extraction-limit",
        type=int,
        default=os.getenv("DEEPEVAL_TRUTHS_EXTRACTION_LIMIT"),
        help="Optional DeepEval SummarizationMetric truths_extraction_limit override.",
    )
    parser.add_argument(
        "--metrics",
        default=os.getenv(
            "DEEPEVAL_METRICS",
            "answer_relevancy,faithfulness,contextual_relevancy",
        ),
        help=(
            "Comma-separated metrics: answer_relevancy, faithfulness, "
            "contextual_relevancy, contextual_precision, contextual_recall"
        ),
    )
    return parser.parse_args()


def load_eval_set(path):
    resolved = Path(path).resolve()
    with resolved.open("r", encoding="utf-8") as file:
        data = json.load(file)

    return resolved, data


def is_placeholder_video_id(video_id):
    return isinstance(video_id, str) and video_id.strip().lower() in PLACEHOLDER_VIDEO_IDS


def require_real_video_id(video_id, eval_set_path):
    if is_placeholder_video_id(video_id):
        raise RuntimeError(
            "The eval set still contains the placeholder videoId "
            f"{video_id!r}. Replace it in {eval_set_path} or pass a real UUID, for example: "
            "npm run eval:deepeval -- --video-id <real-video-uuid>"
        )


def print_summary(report):
    print(f"Evaluation set: {report['evalSetPath']}")
    print(f"API: {report['apiBaseUrl']}")
    if report.get("sessionId"):
        print(f"Session: {report['sessionId']}")
    print(f"Model: {report['model']}")
    print(f"Average score: {report['averageScore']}")
    print("")

    for result in report.get("ragResults", []):
        print(f"- {result['id']}: {result['averageScore']} ({result['retrievalContextCount']} contexts)")
        for metric in result["metrics"]:
            print(f"  {metric['name']}: {metric['score']} | {metric['reason']}")

    summary_result = report.get("summaryResult")
    if summary_result:
        print(
            f"- summary: {summary_result['averageScore']} "
            f"({summary_result['sourceChunkCount']} source chunks)"
        )
        for metric in summary_result["metrics"]:
            print(f"  {metric['name']}: {metric['score']} | {metric['reason']}")


def main():
    load_env_file()
    args = parse_args()

    model = args.model
    if model.startswith("groq:"):
        model_name = model.split(":", 1)[1]
        model = GroqDeepEvalModel(model_name).model
    elif not os.getenv("OPENAI_API_KEY"):
        print(
            "Warning: OPENAI_API_KEY is not set. DeepEval's default judge models require it.",
            file=sys.stderr,
        )

    classes = load_deepeval()
    eval_set_path, eval_set = load_eval_set(args.eval_set)
    video_id = args.video_id or eval_set.get("videoId")
    if video_id and args.mode in {"rag", "summarize", "all"}:
        require_real_video_id(video_id, eval_set_path)

    if not args.session_id and not video_id and args.mode in {"rag", "all"}:
        raise RuntimeError("Provide --session-id, --video-id, SESSION_ID, VIDEO_ID, or videoId in the eval set.")

    if not video_id and not args.summary_id and args.mode in {"summarize", "all"}:
        raise RuntimeError("Provide --video-id, --summary-id, VIDEO_ID, SUMMARY_ID, or videoId in the eval set.")

    metric_names = [name.strip() for name in args.metrics.split(",") if name.strip()]
    needs_expected_output = {"contextual_precision", "contextual_recall"}
    questions = eval_set.get("questions", [])
    missing_expected = [
        item.get("id", item.get("question", "unknown"))
        for item in questions
        if needs_expected_output.intersection(metric_names) and not item.get("expectedOutput")
    ]
    if missing_expected:
        raise RuntimeError(
            "contextual_precision/contextual_recall require expectedOutput. Missing in: "
            + ", ".join(missing_expected)
        )

    if args.truths_extraction_limit:
        eval_set["truthsExtractionLimit"] = int(args.truths_extraction_limit)

    session = None
    rag_results = []
    if args.mode in {"rag", "all"}:
        if not isinstance(questions, list) or not questions:
            raise RuntimeError("RAG evaluation requires a non-empty questions array.")

        session = (
            {"id": args.session_id}
            if args.session_id
            else create_session(
                args.api_base_url,
                video_id,
                f"deepeval-{datetime.now(timezone.utc).isoformat()}",
            )
        )

        for item in questions:
            response = ask_question(args.api_base_url, session["id"], item["question"])
            rag_results.append(
                evaluate_rag_case(
                    classes,
                    item,
                    response,
                    metric_names,
                    args.threshold,
                    model,
                )
            )

    summary_result = None
    if args.mode in {"summarize", "all"}:
        summary = (
            get_summary(args.api_base_url, args.summary_id)
            if args.summary_id
            else create_summary(args.api_base_url, video_id)
        )
        summary_video_id = summary.get("videoId") or video_id
        chunks = get_chunks(args.api_base_url, summary_video_id)
        summary_result = evaluate_summary(
            classes,
            summary,
            chunks,
            eval_set,
            args.threshold,
            model,
        )

    all_scores = [
        result["averageScore"]
        for result in rag_results
        if isinstance(result.get("averageScore"), (int, float))
    ]
    if summary_result and isinstance(summary_result.get("averageScore"), (int, float)):
        all_scores.append(summary_result["averageScore"])

    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "apiBaseUrl": args.api_base_url,
        "evalSetPath": str(eval_set_path),
        "mode": args.mode,
        "sessionId": session["id"] if session else None,
        "videoId": video_id,
        "model": model.get_model_name() if hasattr(model, "get_model_name") else args.model,
        "threshold": args.threshold,
        "metrics": metric_names,
        "averageScore": round(sum(all_scores) / len(all_scores), 4)
        if all_scores
        else None,
        "ragResults": rag_results,
        "summaryResult": summary_result,
    }

    print_summary(report)

    if args.out:
        out_path = Path(args.out).resolve()
        out_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print("")
        print(f"Saved report: {out_path}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
