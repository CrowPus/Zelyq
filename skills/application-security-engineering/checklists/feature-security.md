# Feature Security Checklist

- [ ] What security property must this feature preserve?
- [ ] Who can use it?
- [ ] Which objects/fields can each role access?
- [ ] What inputs are untrusted?
- [ ] Which interpreters/files/network destinations receive them?
- [ ] What if request is repeated?
- [ ] What if two requests happen concurrently?
- [ ] What if dependency fails after a side effect?
- [ ] What resource usage is bounded?
- [ ] What sensitive data is stored/logged?
- [ ] What audit/security event is needed?
- [ ] What abuse case is most damaging?
- [ ] What tests prove allow and deny behavior?
