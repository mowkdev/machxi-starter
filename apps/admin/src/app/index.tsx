import { AppRouter } from "./providers/router";
import "./styles.css";

/**
 * The composition root of the SPA (ADR-0032): the `app` layer is wiring, and
 * this is the whole of it — providers around a router, mounted by `main.tsx`.
 *
 * `D3.5` wraps a `QueryClientProvider` around this, and `D3.4` a session
 * provider; both belong beside `AppRouter` in `providers/`, not here.
 */
const App = () => <AppRouter />;

export default App;
