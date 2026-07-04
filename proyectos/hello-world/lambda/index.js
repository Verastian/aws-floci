exports.handler = async () => {
  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
    body: "<html><body><h1>Hello World</h1><p>Servido desde Lambda emulado por Floci en el VPS.</p></body></html>"
  };
};
