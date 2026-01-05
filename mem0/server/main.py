import logging
import os
import json
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from mem0 import Memory

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

# Load environment variables
load_dotenv()


POSTGRES_HOST = os.environ.get("POSTGRES_HOST", "postgres")
POSTGRES_PORT = os.environ.get("POSTGRES_PORT", "5432")
POSTGRES_DB = os.environ.get("POSTGRES_DB", "postgres")
POSTGRES_USER = os.environ.get("POSTGRES_USER", "postgres")
POSTGRES_PASSWORD = os.environ.get("POSTGRES_PASSWORD", "postgres")
POSTGRES_COLLECTION_NAME = os.environ.get("POSTGRES_COLLECTION_NAME", "memories")

NEO4J_URI = os.environ.get("NEO4J_URI", "bolt://neo4j:7687")
NEO4J_USERNAME = os.environ.get("NEO4J_USERNAME", "neo4j")
NEO4J_PASSWORD = os.environ.get("NEO4J_PASSWORD", "mem0graph")

MEMGRAPH_URI = os.environ.get("MEMGRAPH_URI", "bolt://localhost:7687")
MEMGRAPH_USERNAME = os.environ.get("MEMGRAPH_USERNAME", "memgraph")
MEMGRAPH_PASSWORD = os.environ.get("MEMGRAPH_PASSWORD", "mem0graph")

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
HISTORY_DB_PATH = os.environ.get("HISTORY_DB_PATH", "/app/history/history.db")
CONFIG_PATH = "/app/history/config.json"

DEFAULT_MODELS = {
    "openai": ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
    "azure_openai": ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
    "anthropic": [
        "claude-3-5-sonnet-20240620",
        "claude-3-opus-20240229",
        "claude-3-sonnet-20240229",
    ],
    "ollama": ["ollama/llama3", "ollama/mistral"],
}

DEFAULT_CONFIG = {
    "version": "v1.1",
    "vector_store": {
        "provider": "pgvector",
        "config": {
            "host": POSTGRES_HOST,
            "port": int(POSTGRES_PORT),
            "dbname": POSTGRES_DB,
            "user": POSTGRES_USER,
            "password": POSTGRES_PASSWORD,
            "collection_name": POSTGRES_COLLECTION_NAME,
        },
    },
    "graph_store": {
        "provider": "neo4j",
        "config": {"url": NEO4J_URI, "username": NEO4J_USERNAME, "password": NEO4J_PASSWORD},
    },
    "llm": {"provider": "openai", "config": {"api_key": OPENAI_API_KEY, "temperature": 0.2, "model": "gpt-4.1-nano-2025-04-14"}},
    "embedder": {"provider": "openai", "config": {"api_key": OPENAI_API_KEY, "model": "text-embedding-3-small"}},
    "history_db_path": HISTORY_DB_PATH,
}

def load_config():
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, 'r') as f:
                saved_config = json.load(f)
                config = DEFAULT_CONFIG.copy()
                if "llm" in saved_config:
                    config["llm"] = saved_config["llm"]
                if "embedder" in saved_config:
                    config["embedder"] = saved_config["embedder"]
                return config
        except Exception as e:
            logging.error(f"Failed to load config: {e}")
    return DEFAULT_CONFIG


def load_persisted_state() -> Dict[str, Any]:
    if not os.path.exists(CONFIG_PATH):
        return {}
    try:
        with open(CONFIG_PATH, 'r') as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except Exception as e:
        logging.error(f"Failed to load persisted state: {e}")
        return {}


def save_persisted_state(state: Dict[str, Any]) -> None:
    try:
        with open(CONFIG_PATH, 'w') as f:
            json.dump(state, f, indent=2)
    except Exception as e:
        logging.error(f"Failed to save persisted state: {e}")

def save_config(config):
    try:
        existing = load_persisted_state()
        existing["llm"] = config.get("llm")
        existing["embedder"] = config.get("embedder")
        save_persisted_state(existing)
    except Exception as e:
        logging.error(f"Failed to save config: {e}")

MEMORY_INSTANCE = Memory.from_config(load_config())

app = FastAPI(
    title="Mem0 REST APIs",
    description="A REST API for managing and searching memories for your AI Agents and Apps.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Message(BaseModel):
    role: str = Field(..., description="Role of the message (user or assistant).")
    content: str = Field(..., description="Message content.")


class MemoryCreate(BaseModel):
    messages: List[Message] = Field(..., description="List of messages to store.")
    user_id: Optional[str] = None
    agent_id: Optional[str] = None
    run_id: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class SearchRequest(BaseModel):
    query: str = Field(..., description="Search query.")
    user_id: Optional[str] = None
    run_id: Optional[str] = None
    agent_id: Optional[str] = None
    filters: Optional[Dict[str, Any]] = None


class AddModelRequest(BaseModel):
    provider: str
    model: str
    label: Optional[str] = None
    base_url: Optional[str] = None
    api_key: Optional[str] = None


def _normalize_str(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _get_custom_llm(persisted: Dict[str, Any], provider: str, model: str) -> Optional[Dict[str, Any]]:
    custom_llms = persisted.get("custom_llms")
    if not isinstance(custom_llms, list):
        return None
    provider = _normalize_str(provider)
    model = _normalize_str(model)
    if not provider or not model:
        return None
    for item in custom_llms:
        if not isinstance(item, dict):
            continue
        if _normalize_str(item.get("provider")) == provider and _normalize_str(item.get("model")) == model:
            return item
    return None


def _deep_merge_dict(base: Dict[str, Any], patch: Dict[str, Any]) -> Dict[str, Any]:
    merged: Dict[str, Any] = dict(base)
    for k, v in patch.items():
        if isinstance(v, dict) and isinstance(merged.get(k), dict):
            merged[k] = _deep_merge_dict(merged[k], v)
        else:
            merged[k] = v
    return merged


@app.get("/models", summary="List supported models")
def list_models():
    persisted = load_persisted_state()
    custom_models = persisted.get("custom_models", {})
    custom_llms = persisted.get("custom_llms", [])

    merged: Dict[str, List[Dict[str, Any]]] = {}
    for provider, models in DEFAULT_MODELS.items():
        merged[provider] = [{"model": m, "label": m, "custom": False} for m in list(models)]

    if isinstance(custom_models, dict):
        for provider, models in custom_models.items():
            if not isinstance(provider, str) or not provider.strip():
                continue
            if not isinstance(models, list):
                continue
            merged.setdefault(provider, [])
            for m in models:
                if not isinstance(m, str) or not m.strip():
                    continue
                if any(x.get("model") == m for x in merged[provider]):
                    continue
                merged[provider].append({"model": m, "label": m, "custom": True})

    if isinstance(custom_llms, list):
        for item in custom_llms:
            if not isinstance(item, dict):
                continue
            provider = _normalize_str(item.get("provider"))
            model = _normalize_str(item.get("model"))
            if not provider or not model:
                continue
            label = _normalize_str(item.get("label")) or model
            merged.setdefault(provider, [])
            if any(x.get("model") == model for x in merged[provider]):
                continue
            merged[provider].append({"model": model, "label": label, "custom": True})

    return merged


@app.post("/models", summary="Add a custom model")
def add_model(req: AddModelRequest):
    provider = (req.provider or "").strip()
    model = (req.model or "").strip()
    label = (req.label or "").strip()
    base_url = (req.base_url or "").strip()
    api_key = (req.api_key or "").strip()

    if not provider:
        raise HTTPException(status_code=400, detail="Provider is required")
    if not model:
        raise HTTPException(status_code=400, detail="Model is required")

    persisted = load_persisted_state()
    custom_models = persisted.get("custom_models")
    if not isinstance(custom_models, dict):
        custom_models = {}

    models = custom_models.get(provider)
    if not isinstance(models, list):
        models = []

    if model not in models:
        models.append(model)
    custom_models[provider] = models
    persisted["custom_models"] = custom_models

    custom_llms = persisted.get("custom_llms")
    if not isinstance(custom_llms, list):
        custom_llms = []

    if base_url or api_key or label:
        existing = _get_custom_llm(persisted, provider, model)
        if existing is None:
            entry: Dict[str, Any] = {"provider": provider, "model": model}
            if label:
                entry["label"] = label
            if base_url:
                entry["base_url"] = base_url
            if api_key:
                entry["api_key"] = api_key
            custom_llms.append(entry)
        else:
            if label:
                existing["label"] = label
            if base_url:
                existing["base_url"] = base_url
            if api_key:
                existing["api_key"] = api_key

        persisted["custom_llms"] = custom_llms

    save_persisted_state(persisted)
    return {"message": "Model added", "provider": provider, "model": model}


@app.get("/config", summary="Get current configuration")
def get_config():
    """Get the current memory configuration."""
    config = load_config()
    # Mask API keys for security
    if config.get("llm", {}).get("config", {}).get("api_key"):
        config["llm"]["config"]["api_key"] = "****"
    if config.get("embedder", {}).get("config", {}).get("api_key"):
        config["embedder"]["config"]["api_key"] = "****"
    return config

@app.post("/configure", summary="Configure Mem0")
def set_config(config: Dict[str, Any]):
    """Set memory configuration."""
    global MEMORY_INSTANCE
    try:
        current_config = load_config()

        patch: Dict[str, Any] = {}
        if isinstance(config, dict):
            if isinstance(config.get("llm"), dict):
                patch["llm"] = config["llm"]
            if isinstance(config.get("embedder"), dict):
                patch["embedder"] = config["embedder"]

        merged_config = _deep_merge_dict(current_config, patch) if patch else current_config

        llm = merged_config.get("llm")
        if isinstance(llm, dict):
            provider = _normalize_str(llm.get("provider"))
            llm_cfg = llm.get("config") if isinstance(llm.get("config"), dict) else {}
            model = _normalize_str(llm_cfg.get("model"))
            persisted = load_persisted_state()
            custom = _get_custom_llm(persisted, provider, model)
            if isinstance(custom, dict):
                if "api_key" not in llm_cfg and _normalize_str(custom.get("api_key")):
                    llm_cfg["api_key"] = _normalize_str(custom.get("api_key"))
                if "base_url" not in llm_cfg and _normalize_str(custom.get("base_url")):
                    llm_cfg["base_url"] = _normalize_str(custom.get("base_url"))
                llm["config"] = llm_cfg
                merged_config["llm"] = llm

        MEMORY_INSTANCE = Memory.from_config(merged_config)
        save_config(merged_config)
        return {"message": "Configuration set and saved successfully"}
    except Exception as e:
        logging.exception("Error in set_config:")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/memories", summary="Create memories")
def add_memory(memory_create: MemoryCreate):
    """Store new memories."""
    if not any([memory_create.user_id, memory_create.agent_id, memory_create.run_id]):
        raise HTTPException(status_code=400, detail="At least one identifier (user_id, agent_id, run_id) is required.")

    params = {k: v for k, v in memory_create.model_dump().items() if v is not None and k != "messages"}
    try:
        response = MEMORY_INSTANCE.add(messages=[m.model_dump() for m in memory_create.messages], **params)
        return JSONResponse(content=response)
    except Exception as e:
        logging.exception("Error in add_memory:")  # This will log the full traceback
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/memories", summary="Get memories")
def get_all_memories(
    user_id: Optional[str] = None,
    run_id: Optional[str] = None,
    agent_id: Optional[str] = None,
):
    """Retrieve stored memories."""
    if not any([user_id, run_id, agent_id]):
        raise HTTPException(status_code=400, detail="At least one identifier is required.")
    try:
        params = {
            k: v for k, v in {"user_id": user_id, "run_id": run_id, "agent_id": agent_id}.items() if v is not None
        }
        return MEMORY_INSTANCE.get_all(**params)
    except Exception as e:
        logging.exception("Error in get_all_memories:")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/memories/{memory_id}", summary="Get a memory")
def get_memory(memory_id: str):
    """Retrieve a specific memory by ID."""
    try:
        return MEMORY_INSTANCE.get(memory_id)
    except Exception as e:
        logging.exception("Error in get_memory:")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/search", summary="Search memories")
def search_memories(search_req: SearchRequest):
    """Search for memories based on a query."""
    try:
        params = {k: v for k, v in search_req.model_dump().items() if v is not None and k != "query"}
        return MEMORY_INSTANCE.search(query=search_req.query, **params)
    except Exception as e:
        logging.exception("Error in search_memories:")
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/memories/{memory_id}", summary="Update a memory")
def update_memory(memory_id: str, updated_memory: Dict[str, Any]):
    """Update an existing memory with new content.
    
    Args:
        memory_id (str): ID of the memory to update
        updated_memory (str): New content to update the memory with
        
    Returns:
        dict: Success message indicating the memory was updated
    """
    try:
        return MEMORY_INSTANCE.update(memory_id=memory_id, data=updated_memory)
    except Exception as e:
        logging.exception("Error in update_memory:")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/memories/{memory_id}/history", summary="Get memory history")
def memory_history(memory_id: str):
    """Retrieve memory history."""
    try:
        return MEMORY_INSTANCE.history(memory_id=memory_id)
    except Exception as e:
        logging.exception("Error in memory_history:")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/memories/{memory_id}", summary="Delete a memory")
def delete_memory(memory_id: str):
    """Delete a specific memory by ID."""
    try:
        MEMORY_INSTANCE.delete(memory_id=memory_id)
        return {"message": "Memory deleted successfully"}
    except Exception as e:
        logging.exception("Error in delete_memory:")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/memories", summary="Delete all memories")
def delete_all_memories(
    user_id: Optional[str] = None,
    run_id: Optional[str] = None,
    agent_id: Optional[str] = None,
):
    """Delete all memories for a given identifier."""
    if not any([user_id, run_id, agent_id]):
        raise HTTPException(status_code=400, detail="At least one identifier is required.")
    try:
        params = {
            k: v for k, v in {"user_id": user_id, "run_id": run_id, "agent_id": agent_id}.items() if v is not None
        }
        MEMORY_INSTANCE.delete_all(**params)
        return {"message": "All relevant memories deleted"}
    except Exception as e:
        logging.exception("Error in delete_all_memories:")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/reset", summary="Reset all memories")
def reset_memory():
    """Completely reset stored memories."""
    try:
        MEMORY_INSTANCE.reset()
        return {"message": "All memories reset"}
    except Exception as e:
        logging.exception("Error in reset_memory:")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/", summary="Redirect to the OpenAPI documentation", include_in_schema=False)
def home():
    """Redirect to the OpenAPI documentation."""
    return RedirectResponse(url="/docs")
