//General Use Imports
import { createContext, useContext, useState, useEffect } from 'react';
import PropTypes from 'prop-types';

//MUI Imports
import { ThemeProvider as MUIThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';

const ThemeContext = createContext();

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

export const ThemeProvider = ({ children }) => {
  const [darkMode, setDarkMode] = useState(() => {
    // Try to get the theme from localStorage
    const savedTheme = localStorage.getItem('darkMode');
    return savedTheme ? JSON.parse(savedTheme) : false;
  });

  const theme = createTheme({
    palette: {
      mode: darkMode ? 'dark' : 'light',
      primary: {
        main: darkMode ? '#90caf9' : '#1976d2',
        contrastText: darkMode ? '#fff' : '#fff',
      },
      background: {
        default: darkMode ? '#121212' : '#f4f4f4',
        paper: darkMode ? '#1e1e1e' : '#ffffff',
      },
      text: {
        primary: darkMode ? '#fff' : '#000',
        secondary: darkMode ? '#b0b0b0' : '#666666',
      },
      action: {
        active: darkMode ? '#fff' : '#000',
        hover: darkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.04)',
      },
      divider: darkMode ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.12)',
    },
    components: {
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundColor: darkMode ? '#1e1e1e' : '#ffffff',
            backgroundImage: 'none',
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundColor: darkMode ? '#1e1e1e' : '#ffffff',
            backgroundImage: 'none',
          },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundColor: darkMode ? '#272727' : '#ffffff',
            color: darkMode ? '#fff' : '#000',
          },
        },
      },
      MuiSwitch: {
        styleOverrides: {
          root: {
            '& .MuiSwitch-track': {
              backgroundColor: darkMode ? '#666666' : '#000000',
            },
          },
        },
      },
      MuiSelect: {
        styleOverrides: {
          root: {
            backgroundColor: darkMode ? '#272727' : undefined,
          },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            '&:hover': {
              backgroundColor: darkMode ? '#333333' : '#f5f5f5',
            },
          },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: {
            borderColor: darkMode ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.12)',
            color: darkMode ? '#fff' : '#000',
          },
          head: {
            backgroundColor: darkMode ? '#272727' : '#f5f5f5',
            color: darkMode ? '#fff' : '#000',
            fontWeight: 600,
          },
        },
      },
      MuiTableRow: {
        styleOverrides: {
          root: {
            '&:nth-of-type(odd)': {
              backgroundColor: darkMode ? '#1e1e1e' : '#ffffff',
            },
            '&:nth-of-type(even)': {
              backgroundColor: darkMode ? '#272727' : '#f5f5f5',
            },
            '&:hover': {
              backgroundColor: darkMode ? '#333333' : '#e3f2fd',
            },
          },
        },
      },
      MuiToolbar: {
        styleOverrides: {
          root: {
            backgroundColor: darkMode ? '#272727' : '#ffffff',
            color: darkMode ? '#fff' : '#000',
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          filled: {
            '&.MuiChip-colorPrimary': {
              backgroundColor: darkMode ? '#90caf9' : '#1976d2',
            },
            '&.MuiChip-colorSuccess': {
              backgroundColor: darkMode ? '#66bb6a' : '#2e7d32',
            },
            '&.MuiChip-colorWarning': {
              backgroundColor: darkMode ? '#ffa726' : '#ed6c02',
            },
          },
        },
      },
      MuiInputBase: {
        styleOverrides: {
          root: {
            color: darkMode ? '#fff' : '#000',
            backgroundColor: darkMode ? '#1e1e1e' : undefined,
            '&.Mui-disabled': {
              backgroundColor: darkMode ? '#0a0a0a' : 'lightgrey',
              color: darkMode ? '#2e2e2e' : '#aaa',
            },
          },
        },
      },           
      MuiAutocomplete: {
        styleOverrides: {
          root: {
            backgroundColor: darkMode ? '#1e1e1e' : undefined,
            color: darkMode ? '#fff' : undefined,
            borderRadius: 4,
          },
          inputRoot: {
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: darkMode ? '#555' : undefined,
            },
          },
        },
      },
      MuiCheckbox: {
        styleOverrides: {
          root: {
            color: darkMode ? '#90caf9' : '#1976d2',
            '&.Mui-checked': {
              color: darkMode ? '#2196f3' : '#1976d2',
            },
          },
        },
      },                  
    },
  });

  useEffect(() => {
    // Save theme preference to localStorage whenever it changes
    localStorage.setItem('darkMode', JSON.stringify(darkMode));
    
    // Apply dark mode class to body
    if (darkMode) {
      document.body.classList.add('dark');
    } else {
      document.body.classList.remove('dark');
    }
  }, [darkMode]);

  const toggleDarkMode = () => {
    setDarkMode(prev => !prev);
  };

  return (
    <ThemeContext.Provider value={{ darkMode, toggleDarkMode }}>
      <MUIThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </MUIThemeProvider>
    </ThemeContext.Provider>
  );
};

ThemeProvider.propTypes = {
  children: PropTypes.node.isRequired,
};

export default ThemeContext; 