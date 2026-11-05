import { createRoot } from 'react-dom/client';
import { WidgetContainer } from '@luminovo/widget-sdk';
import { App } from './App';
import './vendor/luminovo-ds-v2.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(
    <WidgetContainer>
        <App />
    </WidgetContainer>,
);
