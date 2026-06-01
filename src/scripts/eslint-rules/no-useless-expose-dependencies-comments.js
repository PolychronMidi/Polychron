module.exports = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Ban comments starting with Expose or Dependencies (these are considered useless)', recommended: false },
    schema: []
  },
  create(context) {
    return {
      'Program:exit'() {
        const source = context.getSourceCode();
        const comments = source.getAllComments ? source.getAllComments() : [];
        for (const c of comments) {
          if (!c || !c.value) continue;
          const txt = c.value.trim();
          if (!txt) continue;
          const lower = txt.toLowerCase();
          if (txt.startsWith('Expose') || txt.startsWith('Dependencies') || lower.startsWith('expose') || lower.startsWith('dependencies')) {
            context.report({ loc: c.loc, message: 'Useless comment banned: comments starting with "Expose" or "Dependencies" are not allowed.' });
          }
        }
      }
    };
  }
};
