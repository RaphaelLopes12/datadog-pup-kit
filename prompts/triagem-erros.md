# Triagem de erros

Troque os valores entre `<>` e cole no agente do Cursor, com o repositório do serviço aberto.

```
O serviço <servico> em <env> está com <sintoma> desde <horario>.

Usando o pup:
1. Agregue os logs de erro da janela por mensagem ou por tipo de exceção e mostre os 5 mais frequentes.
2. Liste os monitors com tag service:<servico> que estão em Alert ou Warn.
3. Busque traces com erro na mesma janela e pegue 2 ou 3 representativos.
4. Veja se houve deploy ou mudança de configuração perto do início do problema.

Depois cruze com o código deste repositório: localize onde a exceção nasce e
aponte a causa mais provável, com a evidência de cada passo (query, janela,
contagem, id do trace). Não altere nada no Datadog nem no código.
```
