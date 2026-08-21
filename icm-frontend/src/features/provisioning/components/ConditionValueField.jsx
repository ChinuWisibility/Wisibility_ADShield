import { useEffect, useMemo, useRef, useState } from "react";
import { Autocomplete, Box, Chip, TextField, Typography } from "@mui/material";
import { identityProfileAPI } from "../../../services/api";

/**
 * Operators that compare against a fragment rather than a whole value, so the picker
 * must let the admin type something that is not itself a stored value.
 */
const PATTERN_OPERATORS = new Set([
  "contains",
  "notContains",
  "startsWith",
  "endsWith",
  "regex",
]);

const VALUE_LIMIT = 20;

/**
 * Value input for a rule condition, offering the values that already exist for the chosen
 * attribute. A rule that says department equals "IT" silently never fires when the data
 * actually says "Information Technology", and that failure is invisible until a Joiner is missed.
 */
export default function ConditionValueField({
  profileId,
  tenantId,
  field,
  operator,
  value,
  onChange,
  disabled = false,
}) {
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [inputValue, setInputValue] = useState(value || "");
  const [fieldHasValues, setFieldHasValues] = useState(true);
  const loadedFieldRef = useRef("");

  useEffect(() => {
    setInputValue(value || "");
  }, [value, field]);

  const allowFreeText = PATTERN_OPERATORS.has(operator) || !fieldHasValues;

  useEffect(() => {
    if (!profileId || !tenantId || !field) {
      setOptions([]);
      setFieldHasValues(true);
      loadedFieldRef.current = "";
      return undefined;
    }

    const controller = new AbortController();
    // Only the first load for a field decides "no data at all"; later loads are filtered.
    const isFirstLoadForField = loadedFieldRef.current !== field;
    const typed = inputValue.trim();
    // After a pick, the input mirrors the selection — reopening should still show every option.
    const echoesSelection = !allowFreeText && typed === String(value || "").trim();
    const query = isFirstLoadForField || echoesSelection ? "" : typed;
    const timer = window.setTimeout(
      () => {
        setLoading(true);
        identityProfileAPI
          .getAttributeValues(
            profileId,
            { tenantId, field, q: query, limit: VALUE_LIMIT },
            { signal: controller.signal },
          )
          .then((res) => {
            const data = res.data?.data || [];
            setOptions(data);
            if (isFirstLoadForField) {
              setFieldHasValues(data.length > 0);
              loadedFieldRef.current = field;
            }
          })
          .catch((error) => {
            if (error?.code !== "ERR_CANCELED") setOptions([]);
          })
          .finally(() => setLoading(false));
      },
      isFirstLoadForField ? 0 : 250,
    );

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [profileId, tenantId, field, inputValue, value, allowFreeText]);

  // Keep an edited rule's saved value selectable even if it is outside the fetched page.
  const mergedOptions = useMemo(() => {
    if (!value || options.some((option) => option.value === value)) return options;
    return [{ value, count: null }, ...options];
  }, [options, value]);

  const helperText = !field
    ? "Pick a field first"
    : allowFreeText && !fieldHasValues
      ? "No identities carry this attribute yet — type the value"
      : PATTERN_OPERATORS.has(operator)
        ? "Suggestions from existing data; free text allowed"
        : "Choose a value that exists in your identity data";

  return (
    <Autocomplete
      fullWidth
      size="small"
      disabled={disabled || !field}
      freeSolo={allowFreeText}
      autoSelect={allowFreeText}
      selectOnFocus
      handleHomeEndKeys
      loading={loading}
      options={mergedOptions}
      // Filtering happens server-side against the whole tenant, not just the loaded page.
      filterOptions={(list) => list}
      value={value ? mergedOptions.find((option) => option.value === value) : null}
      inputValue={inputValue}
      getOptionLabel={(option) => (typeof option === "string" ? option : option?.value || "")}
      isOptionEqualToValue={(option, selected) =>
        option?.value === (typeof selected === "string" ? selected : selected?.value)
      }
      onInputChange={(_event, next, reason) => {
        setInputValue(next);
        if (allowFreeText && reason === "input") onChange(next);
      }}
      onChange={(_event, next) =>
        onChange(typeof next === "string" ? next : next?.value || "")
      }
      renderOption={(props, option) => (
        <Box component="li" {...props} key={option.value}>
          <Typography variant="body2" sx={{ flexGrow: 1 }}>
            {option.value}
          </Typography>
          {option.count ? (
            <Chip
              size="small"
              variant="outlined"
              label={`${option.count} ${option.count === 1 ? "identity" : "identities"}`}
            />
          ) : null}
        </Box>
      )}
      renderInput={(params) => (
        <TextField {...params} label="Value" required helperText={helperText} />
      )}
    />
  );
}
