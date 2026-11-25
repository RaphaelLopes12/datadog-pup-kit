# Investigação de latência

```
O endpoint <rota> do serviço <servico> em <env> ficou lento a partir de <horario>.

Usando o pup:
1. Compare a latência p50, p95 e p99 da última hora com a mesma hora de ontem.
2. Busque os traces mais lentos da rota e quebre o tempo por span: banco,
   chamada HTTP externa, fila, código próprio.
3. Veja as dependências do serviço e se alguma degradou na mesma janela.
4. Confira CPU, memória e reinícios dos hosts ou containers do serviço.

Diga em qual span o tempo está sendo gasto e mostre o trecho deste repositório
que faz essa chamada. Não altere nada no Datadog nem no código.
```
