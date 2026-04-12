"""RAGEngine symbols mixin — symbol indexing, lookup, and search."""
import logging

from .utils import _sanitize

logger = logging.getLogger(__name__)


class RAGEngineSymbolsMixin:
    def _try_open_symbol_table(self):
        try:
            self.symbol_table = self.db.open_table("symbols")
        except Exception:
            self.symbol_table = None

    def index_symbols(self, symbols: list[dict]) -> dict:
        if not symbols:
            return {"indexed": 0}

        records = []
        texts = []
        for s in symbols:
            embed_text = f"{s['kind']} {s['name']} {s['signature']}"
            records.append({
                "id": f"{s['file']}:{s['line']}:{s['name']}",
                "name": s["name"],
                "kind": s["kind"],
                "signature": s["signature"],
                "file": s["file"],
                "line": s["line"],
                "language": s["language"],
            })
            texts.append(embed_text)

        vectors = self._batch_encode(texts)
        for rec, vec in zip(records, vectors):
            rec["vector"] = vec

        self.symbol_table = self.db.create_table(
            "symbols", data=records, schema=self._symbol_schema, mode="overwrite"
        )
        return {"indexed": len(records)}

    def lookup_symbol(self, name: str, kind: str = "", language: str = "") -> list[dict]:
        if self.symbol_table is None:
            return []
        try:
            rows = self.symbol_table.to_arrow().to_pylist()
            results = []
            name_lower = name.lower()
            # Support dotted paths: "module.method" → search for "method" in files matching "module"
            _module_filter = ""
            if "." in name_lower:
                parts = name_lower.rsplit(".", 1)
                _module_filter = parts[0]
                name_lower = parts[1]
            for r in rows:
                if r["name"].lower() != name_lower:
                    continue
                if _module_filter and _module_filter not in r["file"].lower():
                    continue
                if kind and r["kind"] != kind:
                    continue
                if language and r["language"] != language:
                    continue
                results.append({
                    "name": r["name"],
                    "kind": r["kind"],
                    "signature": r["signature"],
                    "file": r["file"],
                    "line": r["line"],
                    "language": r["language"],
                })
            results.sort(key=lambda x: (x["name"].lower() != name_lower, x["kind"], x["file"]))
            return results[:50]
        except Exception as e:
            logger.error(f"Symbol lookup failed: {e}")
            return []

    def search_symbols(self, query: str, top_k: int = 20, kind: str = "") -> list[dict]:
        if self.symbol_table is None:
            return []
        query_vec = self.model.encode(query).tolist()
        builder = self.symbol_table.search(query_vec).limit(top_k)
        if kind:
            builder = builder.where(f"kind = '{_sanitize(kind)}'")
        try:
            results = builder.to_list()
        except Exception as e:
            logger.error(f"Symbol search failed: {e}")
            return []
        out = []
        for r in results:
            score = float(1.0 / (1.0 + r.get("_distance", 0)))
            if score < 0.40:
                continue
            out.append({
                "name": r["name"],
                "kind": r["kind"],
                "signature": r["signature"],
                "file": r["file"],
                "line": r["line"],
                "language": r["language"],
                "score": score,
            })
        return out

    def get_symbol_status(self) -> dict:
        self._try_open_symbol_table()
        if self.symbol_table is None:
            return {"indexed": False, "total_symbols": 0}
        try:
            count = self.symbol_table.count_rows()
            return {"indexed": True, "total_symbols": count}
        except Exception as e:
            logger.warning(f"get_symbol_status count failed: {e}")
            return {"indexed": False, "total_symbols": 0}
