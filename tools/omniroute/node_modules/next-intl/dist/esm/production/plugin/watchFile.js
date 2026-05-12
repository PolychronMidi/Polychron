import r from"fs";import t from"path";function e(e,a){const n=t.dirname(e),o=t.basename(e);return r.watch(n,{persistent:!1,recursive:!1},((r,t)=>{t===o&&a()}))}export{e as default};
