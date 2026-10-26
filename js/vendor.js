import '@fontsource/montserrat/500.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import '@fontsource/montserrat/800.css';
import '@fontsource/poppins/300.css';
import '@fontsource/poppins/400.css';
import '@fontsource/poppins/500.css';
import '@fontsource/poppins/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import 'katex/dist/katex.min.css';
import '../css/app.css';
import '../css/style.css';

import DOMPurify from 'dompurify';
import katex from 'katex';
import renderMathInElement from 'katex/contrib/auto-render';
import { marked } from 'marked';
import { CATALOG } from './generated/chemistry-catalog.js';

import { mountReagentSelect } from './controllers/reagent-select-controller.js';
import { createVisualizationPlan, buildSpeciesLedger } from './domain/visualization-plan.js';

// Temporary compatibility exports for the existing classic scripts. Later
// controller tasks can replace these globals without changing asset delivery.
window.DOMPurify = DOMPurify;
window.katex = katex;
window.marked = marked;
window.renderMathInElement = renderMathInElement;
window.__CHEMISTRY_CATALOG__ = CATALOG;
window.mountReagentSelect = mountReagentSelect;
window.createVisualizationPlan = createVisualizationPlan;
window.buildSpeciesLedger = buildSpeciesLedger;
