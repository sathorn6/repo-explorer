import "babel-polyfill";
import React from "react";
import ReactDOM from "react-dom";
import { App } from "./views/App";
import "./tailwind.css";

ReactDOM.render(<App />, document.getElementById("app"));
