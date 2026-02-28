import morgan from "morgan";

const requestLogger =
  process.env.NODE_ENV === "production" ? morgan("combined") : morgan("dev");

export default requestLogger;
