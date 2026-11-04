import { parseSam } from "./sam.ts";
const s = "<0f>0<|box;x1=20;y1=20;x2=180;y2=120;w=400;h=300|><|mask;x=0;y=0;data=101,161,~!!|><0f>1<|box;x1=1;y1=2;x2=3;y2=4;w=400;h=300|>";
const d = parseSam(s);
if (d.length !== 2 || d[0].x2 !== 180 || !d[0].hasMask || d[1].hasMask) throw new Error("parse failed " + JSON.stringify(d));
console.log("sam parser ok");
