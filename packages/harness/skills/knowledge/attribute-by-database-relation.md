# Attribute adoption through the database relation, never through a name

When a campaign asks "was this thing actually used?", the answer lives in the tool's own database, in
the relation between an instance and the master it was built from. Ask the database for that
relation and you get the truth the tool itself acts on.

**Do not answer it by matching names.** Grepping a netlist for a prefix, counting lines whose text
looks right, or matching a naming convention answers a different question — "does this text appear?"
— and it is wrong in both directions:

- **False positives.** A name that merely resembles the convention is counted. Text in a comment, a
  hierarchical path that contains the prefix on its way somewhere else, an instance that was created
  and then optimized away but still appears in an earlier section of the file.
- **False negatives.** The tool renamed, uniquified, folded or buffered the instance, and the name
  that survives no longer matches anything. Everything you were looking for is there and you count
  zero.

And names are a convention. Conventions change between tool versions, between flows, and between the
person who set them up and the person running the campaign today.

## What this means for a pack you are authoring

- **Read adoption from the tool database, through the instance-to-master relation.** The act node
  runs the tool's own query; the reader reads that query's output into a typed value. Its `Semantics`
  entry says what the relation is, not what the name looks like.
- **Report the denominator too.** "Forty instances adopted" is not a measurement; "forty of two
  hundred and ten instances" is. The chooser and the judge both need the ratio, and a person reading
  the report needs to know what it is out of.
- **If a database query is impossible, say so in the pack rather than substituting a grep.** A pack
  that cannot measure adoption honestly declares that as one of its endings; it does not report a
  number it does not believe.
- **Never let a name-match become the fallback path.** A reader that queries the database and falls
  back to matching names when the query fails will fall back silently, one day, and the campaign will
  end on a number nobody can account for. A failed query is a blocker with the query in it.

## Citing it

When this file shaped a decision, cite it by name and say what it changed — "made the adoption reader
run the tool's own instance-to-master query and report both the count and its denominator, and made a
failed query a blocker rather than a zero".
