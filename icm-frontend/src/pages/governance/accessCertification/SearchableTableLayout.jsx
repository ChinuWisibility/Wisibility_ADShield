import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
    Box, Card, CardContent, TextField, InputAdornment, Pagination, Typography, Chip, Stack, Tooltip
} from '@mui/material';
import { Search as SearchIcon } from '@mui/icons-material';

/* ---------- tokenizer & parser (unchanged semantics) ---------- */

function tokenize(input) {
    const out = [];
    if (!input || !input.trim()) return out;
    const re = /\s*(\(|\)|\bAND\b|\bOR\b|\bNOT\b|-?[A-Za-z0-9_.-]+:"[^"]*"|-?[A-Za-z0-9_.-]+:[^\s()"]+|"[^"]+"|[^\s()]+)\s*/gi;
    let m;
    while ((m = re.exec(input)) !== null) {
        const token = m[1];
        if (!token) continue;
        if (token === '(') { out.push({ type: 'LPAREN' }); continue; }
        if (token === ')') { out.push({ type: 'RPAREN' }); continue; }
        if (/^AND$/i.test(token)) { out.push({ type: 'AND' }); continue; }
        if (/^OR$/i.test(token)) { out.push({ type: 'OR' }); continue; }
        if (/^NOT$/i.test(token)) { out.push({ type: 'NOT' }); continue; }

        const quotedClause = token.match(/^(-?)([A-Za-z0-9_.-]+):"(.+)"$/);
        if (quotedClause) {
            out.push({ type: 'CLAUSE', negate: quotedClause[1] === '-', key: quotedClause[2], value: quotedClause[3], raw: token });
            continue;
        }
        const clause = token.match(/^(-?)([A-Za-z0-9_.-]+):(.+)$/);
        if (clause) {
            out.push({ type: 'CLAUSE', negate: clause[1] === '-', key: clause[2], value: clause[3], raw: token });
            continue;
        }
        const quotedTerm = token.match(/^"(.+)"$/);
        if (quotedTerm) { out.push({ type: 'TERM', value: quotedTerm[1], raw: token }); continue; }
        out.push({ type: 'TERM', value: token, raw: token });
    }
    return out;
}

function parseTokens(tokens) {
    let i = 0;
    const peek = () => tokens[i];
    const consume = () => tokens[i++];

    function parsePrimary() {
        const tk = peek();
        if (!tk) return null;
        if (tk.type === 'NOT') { consume(); const expr = parsePrimary(); return { type: 'NOT', expr }; }
        if (tk.type === 'LPAREN') { consume(); const expr = parseExpression(); if (peek() && peek().type === 'RPAREN') consume(); return expr; }
        if (tk.type === 'CLAUSE') { consume(); return { type: 'CLAUSE', key: tk.key, value: tk.value, negate: !!tk.negate, raw: tk.raw }; }
        if (tk.type === 'TERM') { consume(); return { type: 'TERM', value: tk.value, raw: tk.raw }; }
        return null;
    }

    function parseAnd() {
        let left = parsePrimary();
        if (!left) return null;
        while (true) {
            const t = peek();
            if (!t) break;
            if (t.type === 'AND') { consume(); const right = parsePrimary(); left = { type: 'AND', left, right }; continue; }
            if (['CLAUSE', 'TERM', 'LPAREN', 'NOT'].includes(t.type)) { const right = parsePrimary(); left = { type: 'AND', left, right }; continue; }
            break;
        }
        return left;
    }

    function parseExpression() {
        let left = parseAnd();
        if (!left) return { type: 'EMPTY' };
        while (true) {
            const t = peek();
            if (!t) break;
            if (t.type === 'OR') { consume(); const right = parseAnd(); left = { type: 'OR', left, right }; continue; }
            break;
        }
        return left;
    }

    const ast = parseExpression();
    return ast || { type: 'EMPTY' };
}

function parseQueryToAST(raw) {
    const r = String(raw || '').trim();
    if (!r) return { raw: '', tokens: [], ast: { type: 'EMPTY' } };
    const tokens = tokenize(r);
    const ast = parseTokens(tokens);
    return { raw: r, tokens, ast };
}

/* ---------- default AST evaluator (same as before) ---------- */

function defaultEvaluateAST(ast, row, options = {}) {
    const fields = options.searchableFields || Object.keys(row || {});
    const map = {};
    fields.forEach(f => {
        const v = row[f];
        if (v === undefined || v === null) map[String(f).toLowerCase()] = '';
        else if (typeof v === 'object') {
            try { map[String(f).toLowerCase()] = JSON.stringify(v).toLowerCase(); } catch { map[String(f).toLowerCase()] = ''; }
        } else map[String(f).toLowerCase()] = String(v).toLowerCase();
    });

    const matchClause = (node) => {
        const key = String(node.key || '').toLowerCase();
        const val = String(node.value || '').toLowerCase();
        if (!val) return false;
        if (key in map) return map[key].includes(val);
        return Object.values(map).some(v => v.includes(val));
    };

    function evalNode(n) {
        if (!n) return true;
        switch (n.type) {
            case 'EMPTY': return true;
            case 'CLAUSE': {
                const matched = matchClause(n);
                return n.negate ? !matched : matched;
            }
            case 'TERM': {
                const t = String(n.value || '').toLowerCase();
                if (!t) return true;
                return Object.values(map).some(v => v.includes(t));
            }
            case 'NOT': return !evalNode(n.expr);
            case 'AND': return evalNode(n.left) && evalNode(n.right);
            case 'OR': return evalNode(n.left) || evalNode(n.right);
            default: return true;
        }
    }

    return !!evalNode(ast);
}

/* ---------- utility to remove a token's raw text once from the query string ---------- */
function removeFirstOccurrence(rawQuery, tokenRaw) {
    if (!tokenRaw) return rawQuery;
    const idx = rawQuery.indexOf(tokenRaw);
    if (idx === -1) return rawQuery;
    const before = rawQuery.slice(0, idx).trimEnd();
    const after = rawQuery.slice(idx + tokenRaw.length).trimStart();
    const joined = [before, after].filter(Boolean).join(' ');
    return joined;
}

/* ---------- component (compact sizes) ---------- */

export default function SearchableTableLayout({
    data = [],
    filterFn,                 // (row, parsedQuery) => boolean
    renderToolbarActions,
    children,                 // (paged, filtered, parsed) => ReactNode
    searchPlaceholder = 'name:alice AND (status:active OR -dept:hr)',
    pageSize = 10,
    debounceMs = 300,
    requireKeyValue = false,
    onParsed,
}) {
    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [page, setPage] = useState(0);
    const rowsPerPage = pageSize;
    const timerRef = useRef(null);

    useEffect(() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            setDebouncedQuery(query);
        }, Math.max(0, Number(debounceMs) || 0));
        return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    }, [query, debounceMs]);

    const parsed = useMemo(() => {
        const p = parseQueryToAST(debouncedQuery);
        if (requireKeyValue) {
            // terms will be ignored by default evaluator; UI shows a hint
        }
        if (typeof onParsed === 'function') {
            try { onParsed(p); } catch (e) { /* ignore */ }
        }
        return p;
    }, [debouncedQuery, requireKeyValue, onParsed]);

    const filtered = useMemo(() => {
        if (!parsed.raw) return data;
        if (typeof filterFn === 'function') {
            try {
                return data.filter(row => !!filterFn(row, parsed));
            } catch (e) {
                return data.filter(row => defaultEvaluateAST(parsed.ast, row));
            }
        }
        let astToEval = parsed.ast;
        if (requireKeyValue) {
            function stripTerms(node) {
                if (!node || typeof node !== 'object') return node;
                if (node.type === 'TERM') return { type: 'EMPTY' };
                if (node.type === 'CLAUSE') return node;
                if (node.type === 'NOT') return { type: 'NOT', expr: stripTerms(node.expr) };
                if (node.type === 'AND' || node.type === 'OR') return { type: node.type, left: stripTerms(node.left), right: stripTerms(node.right) };
                return node;
            }
            astToEval = stripTerms(parsed.ast);
        }
        return data.filter(row => defaultEvaluateAST(astToEval, row));
    }, [data, parsed, filterFn, requireKeyValue]);

    const paged = useMemo(() => {
        const start = page * rowsPerPage;
        return filtered.slice(start, start + rowsPerPage);
    }, [filtered, page, rowsPerPage]);

    const pageCount = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
    const handlePageChange = (evt, newPage) => setPage(newPage - 1);

    const clauseChips = (parsed.tokens || []).filter(t => t.type === 'CLAUSE' || t.type === 'TERM').map((t, idx) => {
        const label = t.type === 'CLAUSE' ? `${t.negate ? '-' : ''}${t.key}:${t.value.includes(' ') ? `"${t.value}"` : t.value}` : (String(t.value).includes(' ') ? `"${t.value}"` : t.value);
        return { key: `${t.type}-${idx}`, label, raw: t.raw, type: t.type };
    });

    const removeChip = (chipRaw) => {
        const newQ = removeFirstOccurrence(query, chipRaw);
        setQuery(newQ);
        setPage(0);
    };

    const hasPlainTerms = (parsed.tokens || []).some(t => t.type === 'TERM');

    return (
        <Box>
            <Card sx={{ mb: 1 }}>
                <CardContent sx={{ display: 'flex', gap: 1, flexDirection: 'column', py: 1.25, px: 1.25 }}>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                        <TextField
                            placeholder={searchPlaceholder}
                            size="small"
                            value={query}
                            onChange={(e) => { setQuery(e.target.value); setPage(0); }}
                            sx={{ width: 360, minWidth: 140 }}
                            InputProps={{
                                startAdornment: (
                                    <InputAdornment position="start">
                                        <SearchIcon fontSize="small" />
                                    </InputAdornment>
                                )
                            }}
                        />

                        {renderToolbarActions && (
                            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                                {renderToolbarActions(filtered, parsed)}
                            </Box>
                        )}
                    </Box>

                    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
                        {clauseChips.length > 0 ? (
                            <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                                {clauseChips.map(c => (
                                    <Chip
                                        key={c.key}
                                        label={c.label}
                                        onDelete={() => removeChip(c.raw)}
                                        size="small"
                                        variant="outlined"
                                        sx={{ mr: 0.25, mb: 0.25, fontSize: '0.75rem', lineHeight: 1.1, height: 26 }}
                                    />
                                ))}
                            </Stack>
                        ) : (
                            <Typography variant="caption" color="text.secondary">No active clauses</Typography>
                        )}

                        {requireKeyValue && hasPlainTerms && (
                            <Tooltip title="Plain terms ignored because only key:value queries are allowed">
                                <Typography variant="caption" color="warning.main" sx={{ ml: 0.5 }}>
                                    Plain terms ignored
                                </Typography>
                            </Tooltip>
                        )}
                    </Box>
                </CardContent>
            </Card>

            <Card>
                {children(paged, filtered, parsed)}

                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 1, borderTop: (theme) => `1px solid ${theme.palette.divider}` }}>
                    <Typography variant="caption">{filtered.length} total results</Typography>
                    <Pagination size="small" count={pageCount} page={page + 1} onChange={handlePageChange} color="primary" />
                </Box>
            </Card>
        </Box>
    );
}

