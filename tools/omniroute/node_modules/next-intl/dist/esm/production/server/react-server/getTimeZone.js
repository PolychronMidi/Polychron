import{cache as t}from"react";import n from"./getConfig.js";const o=t((async function(t){return(await n(t)).timeZone}));async function r(t){return o(t?.locale)}export{r as default};
