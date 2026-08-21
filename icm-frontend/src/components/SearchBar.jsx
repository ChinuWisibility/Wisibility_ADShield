import { TextField, InputAdornment } from '@mui/material';
import { Search as SearchIcon } from '@mui/icons-material';
import { palette } from '../theme/palette';

export default function SearchBar({ value, onChange, placeholder = 'Search...', fullWidth, sx }) {
  return (
    <TextField
      size="small"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      fullWidth={fullWidth}
      sx={sx}
      InputProps={{
        startAdornment: (
          <InputAdornment position="start">
            <SearchIcon sx={{ fontSize: 18, color: palette.text.secondary }} />
          </InputAdornment>
        ),
      }}
    />
  );
}
