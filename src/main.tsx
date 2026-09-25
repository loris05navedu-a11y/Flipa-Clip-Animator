import { createRoot } from 'react-dom/client';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-400-italic.css';
import '@fontsource/inter/latin-700-italic.css';
import '@fontsource/lora/latin-400.css';
import '@fontsource/lora/latin-700.css';
import '@fontsource/lora/latin-400-italic.css';
import '@fontsource/fredoka/latin-400.css';
import '@fontsource/fredoka/latin-700.css';
import '@fontsource/bangers/latin-400.css';
import '@fontsource/caveat/latin-400.css';
import '@fontsource/caveat/latin-700.css';
import '@fontsource/permanent-marker/latin-400.css';
import '@fontsource/roboto-mono/latin-400.css';
import '@fontsource/roboto-mono/latin-700.css';
import './styles/base.css';
import './styles/home.css';
import './styles/editor.css';
import { App } from './app/App';
import { installTestHooks } from './app/testHooks';

installTestHooks();

createRoot(document.getElementById('root')!).render(<App />);
