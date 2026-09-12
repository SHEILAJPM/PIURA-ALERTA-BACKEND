// Preload para `node --test` (ver package.json: "test": "node --import ./test/env-setup.js --test").
//
// No sirve poner `process.env.JWT_SECRET ??= "..."` como primera línea de cada
// archivo de test: en ES modules los `import` se evalúan antes que cualquier
// otra sentencia del propio módulo (incluida una que esté escrita antes en el
// archivo), así que src/services/auth.js ya habría lanzado su error de
// "falta JWT_SECRET" antes de llegar a ejecutar esa línea. Un --import previo
// sí corre (y termina) antes de que se evalúe ningún archivo de test.
process.env.JWT_SECRET ??= "test-secret-not-for-production";
